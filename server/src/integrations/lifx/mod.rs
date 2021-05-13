pub mod lights;
pub mod utils;

use anyhow::{Context, Result};
use async_std::channel::{Receiver, Sender};
use async_std::{channel, task};
use async_trait::async_trait;
use homectl_types::{
    device::Device,
    event::TxEventChannel,
    integration::{Integration, IntegrationActionPayload, IntegrationId},
};
use lights::{init_udp_socket, listen_udp_stream, poll_lights};
use serde::Deserialize;
use std::sync::Arc;
use utils::{mk_lifx_udp_msg, to_lifx_state, LifxMsg};

#[derive(Clone, Debug, Deserialize)]
pub struct LifxConfig {}

pub struct Lifx {
    id: IntegrationId,
    config: LifxConfig,
    event_tx: TxEventChannel,
    udp_tx: Sender<LifxMsg>,
    udp_rx: Receiver<LifxMsg>,
}

#[async_trait]
impl Integration for Lifx {
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self> {
        let config = config
            .clone()
            .try_into()
            .context("Failed to deserialize config of Lifx integration")?;
        let (udp_sender, udp_receiver) = channel::unbounded();

        Ok(Lifx {
            id: id.clone(),
            config,
            event_tx,
            udp_tx: udp_sender,
            udp_rx: udp_receiver,
        })
    }

    async fn register(&mut self) -> Result<()> {
        println!("registered lifx integration {}", self.id);

        let config = self.config.clone();
        let integration_id = self.id.clone();
        let sender = self.event_tx.clone();
        let udp_sender_tx = self.udp_tx.clone();
        let udp_sender_rx = self.udp_rx.clone();

        let socket = init_udp_socket(&config).await?;
        let socket = Arc::new(socket);

        listen_udp_stream(Arc::clone(&socket), integration_id, sender);

        task::spawn(async move { poll_lights(udp_sender_tx).await });

        task::spawn(async move {
            loop {
                let res = { udp_sender_rx.recv().await };

                let res = match res {
                    Ok(lifx_msg) => {
                        let target = match lifx_msg.clone() {
                            LifxMsg::Get(addr) => addr,
                            LifxMsg::SetColor(state) => state.addr,
                            LifxMsg::State(state) => state.addr,
                            LifxMsg::SetPower(state) => state.addr,
                            _ => panic!("Send unknown LifxMsg not supported"),
                        };

                        let msg = mk_lifx_udp_msg(lifx_msg);
                        match socket.send_to(&msg.clone(), &target).await {
                            Ok(_size) => {}
                            Err(e) => {
                                println!("Error while sending UDP packet {}", e);
                            }
                        };
                        Ok(())
                    }
                    Err(e) => Err(e),
                };

                res.unwrap_or(());
            }
        });

        Ok(())
    }

    async fn start(&mut self) -> Result<()> {
        println!("started lifx integration {}", self.id);

        Ok(())
    }

    async fn set_integration_device_state(&mut self, device: &Device) -> Result<()> {
        let lifx_state = to_lifx_state(device);

        match lifx_state {
            Ok(lifx_state) => {
                self.udp_tx
                    .send(LifxMsg::SetPower(lifx_state.clone()))
                    .await
                    .expect("Expected to be able to send to lifx channel");

                // don't bother setting color if power is off
                if lifx_state.power != 0 {
                    self.udp_tx
                        .send(LifxMsg::SetColor(lifx_state))
                        .await
                        .expect("Expected to be able to send to lifx channel");
                }
            }
            Err(e) => println!("Error in lifx set_integration_device_state {:?}", e),
        }

        Ok(())
    }

    async fn run_integration_action(&mut self, _: &IntegrationActionPayload) -> Result<()> {
        // do nothing
        Ok(())
    }
}

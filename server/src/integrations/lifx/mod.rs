pub mod lights;
pub mod utils;

use crate::types::{
    custom_integration::CustomIntegration,
    device::Device,
    event::TxEventChannel,
    integration::{IntegrationActionPayload, IntegrationId},
};
use anyhow::{Context, Result};
use async_trait::async_trait;
use lights::{init_udp_socket, listen_udp_stream, poll_lights};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use utils::{mk_lifx_udp_msg, to_lifx_state, LifxMsg};

#[derive(Clone, Debug, Deserialize)]
pub struct LifxConfig {}

pub struct Lifx {
    id: IntegrationId,
    config: LifxConfig,
    event_tx: TxEventChannel,
    udp_tx: Option<UnboundedSender<LifxMsg>>,
}

#[async_trait]
impl CustomIntegration for Lifx {
    fn new(id: &IntegrationId, config: &config::Value, event_tx: TxEventChannel) -> Result<Self> {
        let config = config
            .clone()
            .try_deserialize()
            .context("Failed to deserialize config of Lifx integration")?;

        Ok(Lifx {
            id: id.clone(),
            config,
            event_tx,
            udp_tx: None,
        })
    }

    async fn register(&mut self) -> Result<()> {
        println!("registered lifx integration {}", self.id);

        let config = self.config.clone();
        let integration_id = self.id.clone();
        let sender = self.event_tx.clone();

        let (udp_sender, udp_receiver) = unbounded_channel();

        self.udp_tx = Some(udp_sender.clone());
        let udp_sender_tx = udp_sender;
        let mut udp_sender_rx = udp_receiver;

        let socket = init_udp_socket(&config).await?;
        let socket = Arc::new(socket);

        listen_udp_stream(Arc::clone(&socket), integration_id, sender);

        tokio::spawn(async move { poll_lights(udp_sender_tx).await });

        tokio::spawn(async move {
            loop {
                let res = { udp_sender_rx.recv().await };

                if let Some(lifx_msg) = res {
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
                }
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
                    .as_ref()
                    .expect("Expected udp_tx to be set")
                    .send(LifxMsg::SetPower(lifx_state.clone()))
                    .expect("Expected to be able to send to lifx channel");

                // don't bother setting color if power is off
                if lifx_state.power != 0 {
                    self.udp_tx
                        .as_ref()
                        .expect("Expected udp_tx to be set")
                        .send(LifxMsg::SetColor(lifx_state))
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

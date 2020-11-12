pub mod lights;
pub mod utils;

use crate::homectl_core::{
    device::Device,
    events::TxEventChannel,
    integration::{Integration, IntegrationId},
};
use async_std::sync::Mutex;
use async_trait::async_trait;
use lights::{init_udp_socket, listen_udp_stream, poll_lights};
use mpsc::{Receiver, Sender};
use serde::Deserialize;
use std::sync::{mpsc, Arc};
use utils::{mk_lifx_udp_msg, to_lifx_state, LifxMsg};
use anyhow::{Context, Result};

#[derive(Clone, Debug, Deserialize)]
pub struct LifxConfig {
    network_interface: String,
}

type UdpSenderMsg = LifxMsg;

pub struct Lifx {
    id: String,
    config: LifxConfig,
    sender: TxEventChannel,
    udp_sender_tx: Sender<UdpSenderMsg>,
    udp_sender_rx: Arc<Mutex<Receiver<UdpSenderMsg>>>,
}

#[async_trait]
impl Integration for Lifx {
    fn new(id: &IntegrationId, config: &config::Value, sender: TxEventChannel) -> Result<Self> {
        let config = config.clone().try_into().context("Failed to deserialize config of Lifx integration")?;
        let (udp_sender, udp_receiver) = mpsc::channel();

        Ok(Lifx {
            id: id.clone(),
            config,
            sender,
            udp_sender_tx: udp_sender,
            udp_sender_rx: Arc::new(Mutex::new(udp_receiver)),
        })
    }

    async fn register(&mut self) -> Result<()> {
        println!("registered lifx integration {}", self.id);

        let config = self.config.clone();
        let integration_id = self.id.clone();
        let sender = self.sender.clone();
        let udp_sender_tx = self.udp_sender_tx.clone();
        let udp_sender_rx = self.udp_sender_rx.clone();

        let socket = init_udp_socket(&config).await?;
        let socket = Arc::new(socket);

        listen_udp_stream(Arc::clone(&socket), integration_id, sender);

        tokio::spawn(async move { poll_lights(udp_sender_tx).await });

        tokio::spawn(async move {
            loop {
                let res = {
                    let udp_sender_rx = udp_sender_rx.lock().await;
                    udp_sender_rx.recv()
                };

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

    async fn set_integration_device_state(&mut self, device: Device) {
        let lifx_state = to_lifx_state(device);

        match lifx_state {
            Ok(lifx_state) => {
                self.udp_sender_tx
                    .send(LifxMsg::SetPower(lifx_state.clone()))
                    .unwrap_or(());

                // don't bother setting color if power is off
                if lifx_state.power != 0 {
                    self.udp_sender_tx
                        .send(LifxMsg::SetColor(lifx_state))
                        .unwrap_or(());
                }
            }
            Err(e) => println!("Error in lifx set_integration_device_state {:?}", e),
        }
    }
}

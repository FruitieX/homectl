use anyhow::{Context, Result};

use crate::homectl_core::{
    events::{Message, TxEventChannel},
    integration::IntegrationId,
};

use super::{
    utils::{from_lifx_state, read_lifx_msg, LifxMsg},
    LifxConfig,
};
// use mio::net::UdpSocket;
// use mio::{Events, Interest, Poll, Token};
use async_std::prelude::*;
use async_std::{channel::Sender, net::UdpSocket, stream, task};
use std::sync::Arc;
use std::{net::SocketAddr, time::Duration};

const MAX_UDP_PACKET_SIZE: usize = 1 << 16;

pub async fn init_udp_socket(_config: &LifxConfig) -> Result<UdpSocket> {
    // Setup the UDP socket. LIFX uses port 56700.
    let addr: SocketAddr = "0.0.0.0:56700".parse()?;

    let socket: UdpSocket = UdpSocket::bind(addr).await?;
    socket
        .set_broadcast(true)
        .context("set_broadcast call failed")?;

    Ok(socket)
}

pub async fn handle_lifx_msg(msg: LifxMsg, integration_id: IntegrationId, sender: TxEventChannel) {
    if let LifxMsg::State(state) = msg {
        let device = from_lifx_state(state, integration_id);
        sender.send(Message::IntegrationDeviceRefresh { device });
    }
}

pub fn listen_udp_stream(
    socket: Arc<UdpSocket>,
    integration_id: IntegrationId,
    sender: TxEventChannel,
) {
    let mut buf: [u8; MAX_UDP_PACKET_SIZE] = [0; MAX_UDP_PACKET_SIZE];
    task::spawn(async move {
        loop {
            let res = socket.recv_from(&mut buf).await;

            match res {
                // FIXME: should probably do some sanity checks on bytes_read
                Ok((_bytes_read, addr)) => {
                    let msg = read_lifx_msg(&buf, addr);

                    handle_lifx_msg(msg, integration_id.clone(), sender.clone()).await;
                }
                Err(e) => {
                    println!("Error in udp recv_from {}", e);
                }
            }
        }
    });
}

pub async fn poll_lights(udp_sender_tx: Sender<LifxMsg>) -> Result<()> {
    let poll_rate = Duration::from_millis(1000);
    let mut interval = stream::interval(poll_rate);

    // TODO: find and use the subnet broadcast address instead
    let broadcast_addr: SocketAddr = "255.255.255.255:56700".parse()?;

    let msg = LifxMsg::Get(broadcast_addr);

    loop {
        interval.next().await;

        udp_sender_tx
            .send(msg.clone())
            .await
            .expect("Expected to be able to send to lifx channel");
    }
}

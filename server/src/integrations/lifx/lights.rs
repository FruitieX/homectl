use crate::homectl_core::{
    events::{Message, TxEventChannel},
    integration::IntegrationId,
};

use super::{
    utils::{from_lifx_state, read_lifx_msg, LifxMsg},
    LifxConfig, UdpSenderMsg,
};
// use mio::net::UdpSocket;
// use mio::{Events, Interest, Poll, Token};
use std::io;
use std::{net::SocketAddr, sync::mpsc::Sender, time::Duration};
use tokio::net::{
    udp::{RecvHalf, SendHalf},
    UdpSocket,
};
use tokio::time::{interval_at, Instant};

const MAX_UDP_PACKET_SIZE: usize = 1 << 16;

pub type Socket = (RecvHalf, SendHalf);

pub async fn init_udp_socket(_config: LifxConfig) -> io::Result<Socket> {
    // Setup the UDP socket. LIFX uses port 56700.
    let addr = "0.0.0.0:56700".parse::<SocketAddr>().unwrap();

    let socket = UdpSocket::bind(addr).await?;
    socket
        .set_broadcast(true)
        .expect("set_broadcast call failed");

    Ok(socket.split())
}

pub fn handle_lifx_msg(msg: LifxMsg, integration_id: IntegrationId, sender: TxEventChannel) {
    match msg {
        LifxMsg::State(state) => {
            let device = from_lifx_state(state, integration_id.clone());
            sender
                .send(Message::IntegrationDeviceRefresh { device })
                .unwrap();
        }
        _ => {}
    }
}

pub fn listen_udp_stream(
    mut recv_half: RecvHalf,
    integration_id: IntegrationId,
    sender: TxEventChannel,
) {
    let mut buf: [u8; MAX_UDP_PACKET_SIZE] = [0; MAX_UDP_PACKET_SIZE];
    tokio::spawn(async move {
        loop {
            let res = recv_half.recv_from(&mut buf).await;

            match res {
                // FIXME: should probably do some sanity checks on bytes_read
                Ok((_bytes_read, addr)) => {
                    let msg = read_lifx_msg(&buf, addr);

                    handle_lifx_msg(msg, integration_id.clone(), sender.clone());
                }
                Err(e) => {
                    println!("Error in udp recv_from {}", e);
                }
            }
        }
    });
}

pub async fn poll_lights(udp_sender_tx: Sender<UdpSenderMsg>) -> io::Result<()> {
    let poll_rate = Duration::from_millis(1000);
    let start = Instant::now() + poll_rate;
    let mut interval = interval_at(start, poll_rate);

    // TODO: find and use the subnet broadcast address instead
    let broadcast_addr = "255.255.255.255:56700".parse::<SocketAddr>().unwrap();

    let msg = LifxMsg::Get(broadcast_addr);

    loop {
        interval.tick().await;

        udp_sender_tx.send(msg.clone()).unwrap();
    }
}

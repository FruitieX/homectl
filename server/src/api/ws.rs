use super::with_snapshot;
use crate::core::snapshot::SnapshotHandle;
use crate::core::state::send_state_ws_from_snapshot;
use crate::core::websockets::WebSockets;
use crate::types::event::TxEventChannel;
use crate::types::websockets::WebSocketRequest;
use futures::SinkExt;
use futures_util::StreamExt;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::mpsc;
use warp::{ws::WebSocket, Filter};

/// Our global unique user id counter.
static NEXT_USER_ID: AtomicUsize = AtomicUsize::new(1);

fn with_ws(
    ws: WebSockets,
) -> impl Filter<Extract = (WebSockets,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || ws.clone())
}

fn with_event_tx(
    event_tx: TxEventChannel,
) -> impl Filter<Extract = (TxEventChannel,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || event_tx.clone())
}

pub fn ws(
    snapshot: &SnapshotHandle,
    ws_handle: WebSockets,
    event_tx: TxEventChannel,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("ws")
        // The `ws()` filter will prepare the Websocket handshake.
        .and(warp::ws())
        .and(with_snapshot(snapshot))
        .and(with_ws(ws_handle))
        .and(with_event_tx(event_tx))
        .map(
            |ws: warp::ws::Ws,
             snapshot: SnapshotHandle,
             ws_handle: WebSockets,
             event_tx: TxEventChannel| {
                // This will call our function if the handshake succeeds.
                ws.on_upgrade(move |socket| {
                    user_connected(socket, snapshot, ws_handle, event_tx)
                })
            },
        )
}

// https://github.com/seanmonstar/warp/blob/master/examples/websockets_chat.rs
async fn user_connected(
    ws: WebSocket,
    snapshot: SnapshotHandle,
    ws_handle: WebSockets,
    event_tx: TxEventChannel,
) {
    // Use a counter to assign a new unique ID for this user.
    let my_id = NEXT_USER_ID.fetch_add(1, Ordering::Relaxed);

    // Split the socket into a sender and receive of messages.
    let (mut user_ws_tx, mut user_ws_rx) = ws.split();

    // Use a bounded channel to handle buffering and flushing of messages
    // to the websocket. This prevents slow/dead clients from causing memory issues.
    let (tx, mut rx) = mpsc::channel(100);

    tokio::task::spawn(async move {
        while let Some(message) = rx.recv().await {
            match user_ws_tx.send(message).await {
                Ok(_) => {}
                Err(e) => {
                    warn!("websocket send error (uid={my_id}): {e}, closing connection");
                    break;
                }
            }
        }
    });

    // Save the sender in our list of connected users.
    ws_handle.user_connected(my_id, tx).await;

    // Send snapshot of current state
    send_state_ws_from_snapshot(&snapshot, &ws_handle, Some(my_id)).await;

    // Forward incoming user messages onto the event channel.
    while let Some(result) = user_ws_rx.next().await {
        let msg = match result {
            Ok(msg) => msg,
            Err(e) => {
                warn!("websocket error(uid={my_id}): {e}");
                break;
            }
        };

        let json = msg.to_str();

        if let Ok(json) = json {
            let msg = serde_json::from_str::<WebSocketRequest>(json);

            match msg {
                Ok(WebSocketRequest::EventMessage(event)) => {
                    event_tx.send(event);
                }
                Err(e) => warn!("Error while deserializing websocket message: {e}"),
            }
        }
    }

    // user_ws_rx stream will keep processing as long as the user stays
    // connected. Once they disconnect, then...
    ws_handle.user_disconnected(my_id).await;
}

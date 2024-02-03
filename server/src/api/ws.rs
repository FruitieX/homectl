use super::with_state;
use crate::types::websockets::WebSocketRequest;
use crate::AppState;
use futures::SinkExt;
use futures_util::{StreamExt, TryFutureExt};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tokio::sync::{mpsc, RwLock};
use tokio_stream::wrappers::UnboundedReceiverStream;
use warp::{ws::WebSocket, Filter};

/// Our global unique user id counter.
static NEXT_USER_ID: AtomicUsize = AtomicUsize::new(1);

pub fn ws(
    app_state: &Arc<RwLock<AppState>>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("ws")
        // The `ws()` filter will prepare the Websocket handshake.
        .and(warp::ws())
        .and(with_state(app_state))
        .map(|ws: warp::ws::Ws, app_state: Arc<RwLock<AppState>>| {
            // This will call our function if the handshake succeeds.
            ws.on_upgrade(move |socket| user_connected(socket, app_state))
        })
}

// https://github.com/seanmonstar/warp/blob/master/examples/websockets_chat.rs
async fn user_connected(ws: WebSocket, app_state: Arc<RwLock<AppState>>) {
    // Use a counter to assign a new unique ID for this user.
    let my_id = NEXT_USER_ID.fetch_add(1, Ordering::Relaxed);

    // Split the socket into a sender and receive of messages.
    let (mut user_ws_tx, mut user_ws_rx) = ws.split();

    // Use an unbounded channel to handle buffering and flushing of messages
    // to the websocket...
    let (tx, rx) = mpsc::unbounded_channel();
    let mut rx = UnboundedReceiverStream::new(rx);

    tokio::task::spawn(async move {
        while let Some(message) = rx.next().await {
            user_ws_tx
                .send(message)
                .unwrap_or_else(|e| {
                    warn!("websocket send error: {}", e);
                })
                .await;
        }
    });

    let app_state = app_state.read().await.clone();

    // Save the sender in our list of connected users.
    app_state.ws.user_connected(my_id, tx).await;

    // Send snapshot of current state
    app_state.send_state_ws(Some(my_id)).await;

    // Let AppState handle incoming user messages
    while let Some(result) = user_ws_rx.next().await {
        let msg = match result {
            Ok(msg) => msg,
            Err(e) => {
                warn!("websocket error(uid={}): {}", my_id, e);
                break;
            }
        };

        let json = msg.to_str();

        if let Ok(json) = json {
            let msg = serde_json::from_str::<WebSocketRequest>(json);

            match msg {
                Ok(WebSocketRequest::Message(msg)) => {
                    app_state.event_tx.send(msg);
                }
                Err(e) => warn!("Error while deserializing websocket message: {}", e),
            }
        }
    }

    // user_ws_rx stream will keep processing as long as the user stays
    // connected. Once they disconnect, then...
    app_state.ws.user_disconnected(my_id).await;
}

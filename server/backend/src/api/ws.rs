use super::with_state;
use crate::AppState;
use futures::SinkExt;
use futures_util::{StreamExt, TryFutureExt};
use homectl_types::websockets::WebSocketRequest;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use warp::{ws::WebSocket, Filter};

/// Our global unique user id counter.
static NEXT_USER_ID: AtomicUsize = AtomicUsize::new(1);

pub fn ws(
    app_state: &Arc<AppState>,
) -> impl Filter<Extract = (impl warp::Reply,), Error = warp::Rejection> + Clone {
    warp::path("ws")
        // The `ws()` filter will prepare the Websocket handshake.
        .and(warp::ws())
        .and(with_state(app_state))
        .map(|ws: warp::ws::Ws, app_state: Arc<AppState>| {
            // This will call our function if the handshake succeeds.
            ws.on_upgrade(move |socket| user_connected(socket, app_state))
        })
}

// https://github.com/seanmonstar/warp/blob/master/examples/websockets_chat.rs
async fn user_connected(ws: WebSocket, app_state: Arc<AppState>) {
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
                    eprintln!("websocket send error: {}", e);
                })
                .await;
        }
    });

    // Save the sender in our list of connected users.
    app_state.ws.user_connected(my_id, tx).await;

    // Send snapshot of current state
    app_state.send_state_ws(Some(my_id)).await;

    // Let AppState handle incoming user messages
    while let Some(result) = user_ws_rx.next().await {
        let msg = match result {
            Ok(msg) => msg,
            Err(e) => {
                eprintln!("websocket error(uid={}): {}", my_id, e);
                break;
            }
        };

        let json = msg.to_str().ok();
        let msg = json.and_then(|json| serde_json::from_str::<WebSocketRequest>(json).ok());

        if let Some(WebSocketRequest::Message(msg)) = msg {
            app_state.sender.send(msg);
        }
    }

    // user_ws_rx stream will keep processing as long as the user stays
    // connected. Once they disconnect, then...
    app_state.ws.user_disconnected(my_id).await;
}

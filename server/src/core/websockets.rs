use std::{collections::HashMap, sync::Arc};

use crate::types::websockets::WebSocketResponse;
use tokio::sync::{mpsc::Sender, RwLock};

type Users = Arc<RwLock<HashMap<usize, Sender<warp::ws::Message>>>>;

#[derive(Clone, Default)]
pub struct WebSockets {
    users: Users,
}

impl WebSockets {
    pub async fn user_connected(&self, user_id: usize, sender: Sender<warp::ws::Message>) {
        self.users.write().await.insert(user_id, sender);
    }

    pub async fn user_disconnected(&self, user_id: usize) {
        self.users.write().await.remove(&user_id);
    }

    pub async fn num_users(&self) -> usize {
        self.users.read().await.len()
    }

    pub async fn send(&self, user_id: Option<usize>, message: &WebSocketResponse) -> Option<()> {
        let s = serde_json::to_string(message).unwrap();
        let msg = warp::ws::Message::text(s);

        let mut users = self.users.write().await;

        match user_id {
            Some(user_id) => {
                if let Some(user) = users.get(&user_id) {
                    // try_send fails immediately if channel is full (client is slow)
                    if user.try_send(msg).is_err() {
                        warn!("Removing slow WebSocket client {user_id}");
                        users.remove(&user_id);
                        return None;
                    }
                }
                Some(())
            }
            None => {
                // Broadcast to all users
                let mut dead_users = Vec::new();

                for (id, user) in users.iter() {
                    if user.try_send(msg.clone()).is_err() {
                        dead_users.push(*id);
                    }
                }

                // Clean up dead/slow connections
                for id in dead_users {
                    warn!("Removing dead/slow WebSocket client {id}");
                    users.remove(&id);
                }

                Some(())
            }
        }
    }
}

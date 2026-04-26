use std::{collections::HashMap, sync::Arc};

use serde::Serialize;
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

    pub async fn send<T>(&self, user_id: Option<usize>, message: &T) -> Option<()>
    where
        T: Serialize + ?Sized,
    {
        let s = match serde_json::to_string(message) {
            Ok(s) => s,
            Err(error) => {
                warn!("Failed to serialize WebSocket message: {error}");
                return None;
            }
        };
        let msg = warp::ws::Message::text(s);

        match user_id {
            Some(user_id) => {
                let user = { self.users.read().await.get(&user_id).cloned() };
                if let Some(user) = user {
                    // try_send fails immediately if channel is full (client is slow)
                    if user.try_send(msg).is_err() {
                        warn!("Removing slow WebSocket client {user_id}");
                        self.user_disconnected(user_id).await;
                        return None;
                    }
                }
                Some(())
            }
            None => {
                let users = {
                    self.users
                        .read()
                        .await
                        .iter()
                        .map(|(id, sender)| (*id, sender.clone()))
                        .collect::<Vec<_>>()
                };
                let mut dead_users = Vec::new();

                for (id, user) in users {
                    if user.try_send(msg.clone()).is_err() {
                        dead_users.push(id);
                    }
                }

                if !dead_users.is_empty() {
                    let mut users = self.users.write().await;
                    for id in dead_users {
                        warn!("Removing dead/slow WebSocket client {id}");
                        users.remove(&id);
                    }
                }

                Some(())
            }
        }
    }
}

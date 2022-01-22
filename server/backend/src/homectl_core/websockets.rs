use std::{collections::HashMap, sync::Arc};

use homectl_types::websockets::WebSocketResponse;
use tokio::sync::{
    mpsc::{self, UnboundedSender},
    RwLock,
};

type Users = Arc<RwLock<HashMap<usize, mpsc::UnboundedSender<warp::ws::Message>>>>;

#[derive(Clone, Default)]
pub struct WebSockets {
    users: Users,
}

impl WebSockets {
    pub async fn user_connected(&self, user_id: usize, sender: UnboundedSender<warp::ws::Message>) {
        self.users.write().await.insert(user_id, sender);
    }

    pub async fn user_disconnected(&self, user_id: usize) {
        self.users.write().await.remove(&user_id);
    }

    pub async fn send(&self, user_id: Option<usize>, message: &WebSocketResponse) -> Option<()> {
        let s = serde_json::to_string(message).unwrap();
        let msg = warp::ws::Message::text(s);

        let users = self.users.read().await;

        match user_id {
            Some(user_id) => {
                let user = users.get(&user_id).cloned()?;
                user.send(msg).ok()
            }
            None => {
                let users = users.clone();
                for (_, user) in users {
                    user.send(msg.clone()).ok();
                }

                Some(())
            }
        }
    }
}

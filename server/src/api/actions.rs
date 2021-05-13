use std::sync::Arc;

use rocket::State;
use rocket_contrib::json::Json;

use crate::homectl_core::{actions::Action, events::Message, state::AppState};

#[post("/actions/trigger", data = "<action>")]
pub async fn post_action(action: Json<Action>, app_state: &State<Arc<AppState>>) -> Json<()> {
    let sender = app_state.sender.clone();
    sender.send(Message::Action(action.0));

    Json(())
}

use async_std::task;
use std::sync::Arc;

use crate::AppState;

mod devices;

use devices::*;

pub fn init_api(state: &Arc<AppState>) {
    let state = Arc::clone(state);

    task::spawn(async move {
        rocket::ignite()
            .manage(state)
            .mount("/", routes![get_devices])
            .launch();
    });
}

use async_std::task;
use std::sync::Arc;

use crate::AppState;

mod devices;

use devices::*;

use anyhow::Result;
use rocket::config::{Config, Environment, LoggingLevel};
use rocket::fairing::{Fairing, Info, Kind};
use rocket::http::Header;
use rocket::{Request, Response};

pub struct CORS();

impl Fairing for CORS {
    fn info(&self) -> Info {
        Info {
            name: "Add CORS headers to requests",
            kind: Kind::Response,
        }
    }

    fn on_response(&self, request: &Request, response: &mut Response) {
        response.set_header(Header::new("Access-Control-Allow-Origin", "*"));
        response.set_header(Header::new(
            "Access-Control-Allow-Methods",
            "POST, PUT, GET, PATCH, DELETE, OPTIONS",
        ));
        response.set_header(Header::new("Access-Control-Allow-Headers", "*"));
        response.set_header(Header::new("Access-Control-Allow-Credentials", "true"));
    }
}

pub fn init_api(state: &Arc<AppState>) -> Result<()> {
    let state = Arc::clone(state);

    let config = Config::build(Environment::Staging)
        .address("0.0.0.0")
        .port(45289)
        // Without this there's a lot of spam when polling HA system state
        .log_level(LoggingLevel::Critical)
        .finalize()?;

    task::spawn(async move {
        rocket::custom(config)
            .attach(CORS())
            .manage(state)
            .mount("/", routes![get_devices])
            .launch();
    });

    Ok(())
}

use std::{
    net::{IpAddr, Ipv4Addr},
    sync::Arc,
};

use crate::AppState;

mod devices;

use devices::*;

use anyhow::Result;
use rocket::fairing::{Fairing, Info, Kind};
use rocket::{config::Shutdown, http::Header};
use rocket::{
    config::{Config, LogLevel},
    tokio,
};
use rocket::{Request, Response};

pub struct Cors();

#[async_trait]
impl Fairing for Cors {
    fn info(&self) -> Info {
        Info {
            name: "Add CORS headers to requests",
            kind: Kind::Response,
        }
    }

    async fn on_response<'r>(&self, _req: &'r Request<'_>, res: &mut Response<'r>) {
        res.set_header(Header::new("Access-Control-Allow-Origin", "*"));
        res.set_header(Header::new(
            "Access-Control-Allow-Methods",
            "POST, PUT, GET, PATCH, DELETE, OPTIONS",
        ));
        res.set_header(Header::new("Access-Control-Allow-Headers", "*"));
        res.set_header(Header::new("Access-Control-Allow-Credentials", "true"));
    }
}

pub fn init_api(state: &Arc<AppState>) -> Result<()> {
    let state = Arc::clone(state);

    let config = Config {
        address: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        port: 45289,
        log_level: LogLevel::Critical,
        shutdown: Shutdown {
            ctrlc: false,
            ..Shutdown::default()
        },
        ..Config::default()
    };

    tokio::spawn(async move {
        rocket::custom(config)
            .attach(Cors())
            .manage(state)
            .mount("/", routes![get_devices])
            .launch()
            .await
            .expect("Failed to start Rocket server");
    });

    Ok(())
}

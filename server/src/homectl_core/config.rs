extern crate config;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize, Debug)]
pub struct Config {
    pub integrations: HashMap<String, String>,
}

pub fn read_config() -> Config {
    let mut settings = config::Config::default();

    settings.merge(config::File::with_name("Settings")).unwrap();

    settings.try_into::<Config>().unwrap()
}

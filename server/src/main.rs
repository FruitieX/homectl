#[macro_use]
extern crate diesel;

mod core;
mod db;

use db::{actions::find_floorplans, establish_connection};

// https://github.com/actix/examples/blob/master/diesel/src/main.rs
fn main() {
    let settings = core::config::read_config();

    println!("Hello, world!");
    println!("{:#?}", settings);

    let connection = establish_connection();
    let results = find_floorplans(&connection);
    println!("Floorplans in DB: {:?}", results)
}

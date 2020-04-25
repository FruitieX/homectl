#[macro_use]
extern crate diesel;

mod core;
mod db;
mod models;
mod schema;

use self::diesel::prelude::*;
use self::models::*;
use db::establish_connection;

fn main() {
    use schema::floorplans::dsl::*;
    let settings = core::config::read_config();

    println!("Hello, world!");
    println!("{:#?}", settings);

    let connection = establish_connection();
    let results = floorplans
        .limit(5)
        .load::<Floorplan>(&connection)
        .expect("Error loading floorplans");

    println!("Floorplans in DB: {:?}", results)
}

//! homectl-server library crate.
//!
//! This module re-exports the core functionality for use in tests and
//! other crates that may want to embed homectl functionality.

#[macro_use]
extern crate macro_attr;

#[macro_use]
extern crate newtype_derive;

#[macro_use]
extern crate log;

#[macro_use]
extern crate eyre;

pub mod api;
pub mod core;
pub mod db;
pub mod integrations;
pub mod types;
pub mod utils;

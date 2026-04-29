#! /bin/bash

# Default persistence uses ./homectl.db. Uncomment to use PostgreSQL instead:
# DATABASE_URL=postgres://homectl:homectl@localhost/homectl 
# RUST_LOG=homectl_server=info cargo run
RUST_LOG=debug,rumqttc=warn cargo run

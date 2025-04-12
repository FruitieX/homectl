#!/bin/bash

# A133
# Ubuntu 20.04.6 LTS (GNU/Linux 4.9.170 aarch64)
# glibc_2_31

# rustc 1.85.1 (4eb161250 2025-03-15)

# Set the target architecture and Docker image version
RUST_IMAGE="rust:1.85.1-bullseye"
TARGET_ARCH="aarch64-unknown-linux-gnu"

# Ensure you're in the project directory
if [ ! -f "Cargo.toml" ]; then
  echo "Error: Cargo.toml not found in the current directory!"
  exit 1
fi

echo "Building Rust project with $RUST_IMAGE for target architecture: $TARGET_ARCH"

# Run Docker container to build the project
docker run --rm \
  -v "$PWD:/src" \
  -w /src \
  $RUST_IMAGE \
  cargo build --target $TARGET_ARCH --release

# Check if build was successful
if [ $? -eq 0 ]; then
  echo "Build output: target/aarch64-unknown-linux-gnu/release/homectl-server"
  echo "Build successful!"
else
  echo "Build failed!"
  exit 1
fi

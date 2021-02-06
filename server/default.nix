let
  moz_overlay = import (builtins.fetchTarball https://github.com/mozilla/nixpkgs-mozilla/archive/8c007b60731c07dd7a052cce508de3bb1ae849b4.tar.gz);
  nixpkgs = import <nixpkgs> { overlays = [ moz_overlay ]; };
  rustNightlyChannel = (nixpkgs.rustChannelOf { date = "2021-01-16"; channel = "nightly"; }).rust.override {
    extensions = [
      "rust-src"
      "rust-analysis"
      "rustfmt-preview"
      "clippy-preview"
    ];
  };
in
  with nixpkgs;
  stdenv.mkDerivation {
    name = "env";
    buildInputs = [
      # (nixpkgs.rustChannelOf { rustToolchain = ./rust-toolchain; }).rust
      rustNightlyChannel

      docker-compose
      openssl
      pkg-config
      postgresql
    ];
  }

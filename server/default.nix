let
  moz_overlay = import (builtins.fetchTarball https://github.com/mozilla/nixpkgs-mozilla/archive/8c007b60731c07dd7a052cce508de3bb1ae849b4.tar.gz);
  nixpkgs = import <nixpkgs> { overlays = [ moz_overlay ]; };
  rustStableChannel = (nixpkgs.rustChannels.stable).rust.override {
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
      rustStableChannel

      docker-compose
      openssl
      pkg-config
      postgresql
    ];
  }

let
  moz_overlay = import (builtins.fetchTarball https://github.com/mozilla/nixpkgs-mozilla/archive/8c007b60731c07dd7a052cce508de3bb1ae849b4.tar.gz);
  nixpkgs = import <nixpkgs> { overlays = [ moz_overlay ]; };
  rust-moz-overlay = (nixpkgs.latest.rustChannels.nightly.rust.override { extensions = [ "rust-src" "rust-analysis" "rustfmt-preview" ];});
in
  with nixpkgs;
  stdenv.mkDerivation {
    name = "env";
    buildInputs = [
      docker-compose
      rust-moz-overlay
      openssl
      pkg-config
    ];
  }

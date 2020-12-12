let
  moz_overlay = import (builtins.fetchTarball https://github.com/mozilla/nixpkgs-mozilla/archive/4521bc6.tar.gz);
  nixpkgs = import <nixpkgs> { overlays = [ moz_overlay ]; };
  ruststable = (nixpkgs.latest.rustChannels.stable.rust.override { extensions = [ "rust-src" "rls-preview" "rust-analysis" "rustfmt-preview" ];});
in
  with nixpkgs;
  stdenv.mkDerivation {
    name = "env";
    buildInputs = [
      ruststable
      # bashInteractive
      openssl
      pkg-config
    ];
  }

let
  unstable = import (fetchTarball https://nixos.org/channels/nixos-unstable/nixexprs.tar.xz) { };
  moz_overlay = import (builtins.fetchTarball https://github.com/mozilla/nixpkgs-mozilla/archive/master.tar.gz );
  nixpkgs = import <nixpkgs> { overlays = [ moz_overlay ]; };
  rustStableChannel = (nixpkgs.rustChannels.stable).rust.override {
    extensions = [
      "rust-src"
      "rust-analysis"
      "rustfmt-preview"
      "clippy-preview"
    ];
    targets = [
      "x86_64-unknown-linux-gnu"
      "wasm32-unknown-unknown"
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

      nodejs

      clang
      unstable.mold
    ];

    # Make cargo use the mold linker for this project
    shellHook = ''
      mkdir -p backend/.cargo
      cat << EOF > backend/.cargo/config.toml
      [build]
      target = "x86_64-unknown-linux-gnu"

      [target.x86_64-unknown-linux-gnu]
      linker = "clang"
      rustflags = ["-C", "link-arg=-fuse-ld=${unstable.mold}/bin/mold"]
      EOF
    '';
  }

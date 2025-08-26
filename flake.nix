{
  description = "homectl monorepo (server + ui)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay.url = "github:oxalica/rust-overlay";
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay }: flake-utils.lib.eachDefaultSystem (system:
    let
      overlays = [ rust-overlay.overlays.default ];
      pkgs = import nixpkgs { inherit system overlays; };
      rustToolchain = (pkgs.rust-bin.fromRustupToolchainFile ./server/rust-toolchain.toml).override {
        extensions = [ "rust-src" "rust-analysis" "rustfmt-preview" "clippy-preview" ];
        targets = [ "x86_64-unknown-linux-gnu" "x86_64-unknown-linux-musl" ];
      };
    in {
      devShells = {
        default = pkgs.mkShell {
          name = "homectl";
          buildInputs = [
            rustToolchain
            pkgs.pkg-config
            pkgs.postgresql
            pkgs.openssl
            pkgs.nodejs
            pkgs.docker-compose
          ];
          shellHook = ''
            echo "Loaded homectl dev shell (server + ui)"
          '';
        };
        server = pkgs.mkShell {
          name = "homectl-server";
            buildInputs = [
              rustToolchain
              pkgs.pkg-config
              pkgs.postgresql
              pkgs.openssl
            ];
        };
        ui = pkgs.mkShell {
          name = "homectl-ui";
          buildInputs = [ pkgs.nodejs ];
        };
      };
    }
  );
}

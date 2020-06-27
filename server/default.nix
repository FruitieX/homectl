with import <nixpkgs> {};
stdenv.mkDerivation {
  name = "env";
  buildInputs = [
    bashInteractive
    rustup
    cargo
    openssl
    pkg-config
  ];
}

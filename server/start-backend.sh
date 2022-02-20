#! /usr/bin/env nix-shell
#! nix-shell -i bash default.nix

cargo run -p homectl --release

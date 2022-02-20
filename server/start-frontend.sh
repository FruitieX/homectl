#! /usr/bin/env nix-shell
#! nix-shell -i bash default.nix

cargo install trunk
cd frontend
npm install
node_modules/.bin/tailwindcss -i tailwindcss.css -o index.css
trunk serve

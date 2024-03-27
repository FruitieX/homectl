FROM gcr.io/distroless/static@sha256:046b92c933032a8ca99a66f4c79a68ac029d9a4ababd1a806a82140b3b899fd3
COPY target/x86_64-unknown-linux-musl/release/homectl-server /usr/local/bin/homectl-server
WORKDIR /app
CMD ["homectl-server"]

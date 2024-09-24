FROM gcr.io/distroless/static@sha256:69830f29ed7545c762777507426a412f97dad3d8d32bae3e74ad3fb6160917ea
COPY target/x86_64-unknown-linux-musl/release/homectl-server /usr/local/bin/homectl-server
WORKDIR /app
CMD ["homectl-server"]

FROM gcr.io/distroless/static@sha256:7e5c6a2a4ae854242874d36171b31d26e0539c98fc6080f942f16b03e82851ab
COPY target/x86_64-unknown-linux-musl/release/homectl-server /usr/local/bin/homectl-server
WORKDIR /app
CMD ["homectl-server"]

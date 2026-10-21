FROM gcr.io/distroless/static@sha256:9e0130bec991f471279b70f1630ada11e46dad439ef2949544f96001225329fb
COPY target/x86_64-unknown-linux-musl/release/homectl-server /usr/local/bin/homectl-server
WORKDIR /app
CMD ["homectl-server"]

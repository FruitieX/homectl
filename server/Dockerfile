FROM gcr.io/distroless/static@sha256:2e114d20aa6371fd271f854aa3d6b2b7d2e70e797bb3ea44fb677afec60db22c
COPY target/x86_64-unknown-linux-musl/release/homectl-server /usr/local/bin/homectl-server
WORKDIR /app
CMD ["homectl-server"]

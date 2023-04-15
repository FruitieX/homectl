FROM rust:1.68 AS builder
WORKDIR /usr/src/homectl-server
COPY . .
WORKDIR /usr/src/homectl-server/homectl-server
RUN apt-get update && apt-get install -y build-essential
RUN cargo install --path .

FROM debian:bullseye-slim
RUN apt-get update && apt-get install -y ca-certificates openssl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/cargo/bin/homectl-server /usr/local/bin/homectl-server
CMD ["homectl-server"]

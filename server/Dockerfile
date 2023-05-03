FROM rust:1.69 AS builder

RUN apt-get update && apt-get install -y build-essential

WORKDIR /usr/src/homectl-server
COPY . .
RUN \
	--mount=type=cache,target=/usr/local/cargo/registry \
	--mount=type=cache,target=/usr/src/homectl-server/target \
	cargo install --path homectl-server

FROM debian:bullseye-slim
RUN apt-get update && apt-get install -y ca-certificates openssl libcurl4 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/cargo/bin/homectl-server /usr/local/bin/homectl-server
CMD ["homectl-server"]

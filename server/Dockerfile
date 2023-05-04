FROM rust:1.69 AS chef 
RUN cargo install cargo-chef 
WORKDIR app

FROM chef AS planner
COPY . .
RUN cargo chef prepare  --recipe-path recipe.json

FROM chef AS builder

# Build dependencies
COPY --from=planner /app/recipe.json recipe.json
RUN \
	--mount=type=cache,target=/usr/local/cargo/registry \
	--mount=type=cache,target=/app/target \
	cargo chef cook --release --recipe-path recipe.json

# Build application
COPY . .
RUN \
	--mount=type=cache,target=/usr/local/cargo/registry \
	--mount=type=cache,target=/app/target \
	cargo install --path .

FROM gcr.io/distroless/cc
COPY --from=builder /usr/local/cargo/bin/homectl-server /usr/local/bin/homectl-server
CMD ["homectl-server"]

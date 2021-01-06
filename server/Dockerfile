FROM rustlang/rust:nightly as planner
WORKDIR /app
# We only pay the installation cost once,
# it will be cached from the second build onwards
RUN cargo install cargo-chef
COPY src src
COPY Cargo.toml .
COPY Cargo.lock .
RUN cargo chef prepare --recipe-path recipe.json

FROM rustlang/rust:nightly as cacher
WORKDIR app
RUN cargo install cargo-chef
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

FROM rustlang/rust:nightly as builder
WORKDIR app
COPY src src
COPY Cargo.toml .
COPY Cargo.lock .
# Copy over the cached dependencies
COPY --from=cacher /app/target target
COPY --from=cacher $CARGO_HOME $CARGO_HOME
RUN cargo build --release --bin homectl

FROM rustlang/rust:nightly as runtime
WORKDIR app
COPY --from=builder /app/target/release/homectl /usr/local/bin
COPY Settings.toml .

ENTRYPOINT ["homectl"]
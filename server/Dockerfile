FROM rustlang/rust:nightly

RUN cargo install diesel_cli --no-default-features --features postgres

WORKDIR /usr/src/homectl
COPY . .

RUN cargo install --path .

CMD diesel setup --database-url postgres://postgres@postgres-homectl/homectl && homectl
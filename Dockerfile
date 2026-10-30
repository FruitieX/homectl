FROM node:26.13.0-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS ui-builder

RUN apk add --no-cache pango-dev g++ make jpeg-dev giflib-dev librsvg-dev
# Node 25+ no longer bundles corepack; keep pnpm in step with CI.
RUN npm install --global pnpm@12.16.1

WORKDIR /app/ui

COPY ui/package.json ui/pnpm-lock.yaml ui/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY ui ./
ARG VITE_GIT_COMMIT
ARG VITE_BUILD_DATE
RUN VITE_GIT_COMMIT="$VITE_GIT_COMMIT" VITE_BUILD_DATE="$VITE_BUILD_DATE" pnpm build

# The workspace dependencies declare rust-version 1.94 (sea-orm 2, sqlx 0.9), so
# the image toolchain must not trail the flake's.
FROM rust:1.99.1-slim-trixie@sha256:b8e062b1c3a80183df83d9ba187cadd2b5ab84bc78d453dbfeb2fccd5f982247 AS server-builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY cli ./cli
COPY server ./server

RUN cargo build --release -p homectl-server

FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4 AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV HOMECTL_UI_DIST_DIR=/app/ui/dist

WORKDIR /app

COPY --from=server-builder /app/target/release/homectl-server /usr/local/bin/homectl-server
COPY --from=server-builder /app/target/release/script-worker /usr/local/bin/script-worker
RUN /usr/local/bin/script-worker </dev/null
COPY --from=ui-builder /app/ui/dist /app/ui/dist

EXPOSE 45289

CMD ["/usr/local/bin/homectl-server"]

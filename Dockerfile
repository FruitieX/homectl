FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS ui-builder

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
FROM rust:1.99.1-slim-trixie@sha256:f6c4a35d21dbb3c89d7a8d056c193e94fc09037f2b58dd858b09c39a47dd02d7 AS server-builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY cli ./cli
COPY server ./server

RUN cargo build --release -p homectl-server

FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2 AS runtime

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

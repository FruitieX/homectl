FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS ui-builder

RUN apk add --no-cache pango-dev g++ make jpeg-dev giflib-dev librsvg-dev
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate

WORKDIR /app/ui

COPY ui/package.json ui/pnpm-lock.yaml ui/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY ui ./
ARG VITE_GIT_COMMIT
ARG VITE_BUILD_DATE
RUN VITE_GIT_COMMIT="$VITE_GIT_COMMIT" VITE_BUILD_DATE="$VITE_BUILD_DATE" pnpm build

# The workspace dependencies declare rust-version 1.94 (sea-orm 2, sqlx 0.9), so
# the image toolchain must not trail the flake's.
FROM rust:1.99-slim-bookworm@sha256:2c3a22f0a5533ea2dd5a16627bc841228151faa2d4de2644ac9987e4a2f1f2fa AS server-builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY cli ./cli
COPY server ./server

RUN cargo build --release -p homectl-server

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS runtime

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

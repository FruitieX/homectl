FROM node:22.20.0-alpine@sha256:dbcedd8aeab47fbc0f4dd4bffa55b7c3c729a707875968d467aaaea42d6225af AS ui-builder

RUN apk add --no-cache pango-dev g++ make jpeg-dev giflib-dev librsvg-dev
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate

WORKDIR /app/ui

COPY ui/package.json ui/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY ui ./
ARG VITE_GIT_COMMIT
ARG VITE_BUILD_DATE
RUN VITE_GIT_COMMIT="$VITE_GIT_COMMIT" VITE_BUILD_DATE="$VITE_BUILD_DATE" pnpm build

FROM rust:1.90-slim-bookworm AS server-builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY cli ./cli
COPY server ./server

RUN cargo build --release -p homectl-server

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV HOMECTL_UI_DIST_DIR=/app/ui/dist

WORKDIR /app

COPY --from=server-builder /app/target/release/homectl-server /usr/local/bin/homectl-server
COPY --from=ui-builder /app/ui/dist /app/ui/dist

EXPOSE 45289

CMD ["/usr/local/bin/homectl-server"]

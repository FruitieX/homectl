FROM node:22.12.0-alpine@sha256:96cc8323e25c8cc6ddcb8b965e135cfd57846e8003ec0d7bcec16c5fd5f6d39f AS base

# Install dependencies
FROM base AS deps
RUN apk add npm pango-dev g++ make jpeg-dev giflib-dev librsvg-dev
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN yarn global add pnpm && pnpm i --frozen-lockfile

# Build app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED 1
ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

USER nextjs

EXPOSE 3000

ENV PORT 3000

CMD ["npm", "start"]

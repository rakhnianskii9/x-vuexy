# syntax=docker/dockerfile:1.7-labs
ARG NODE_VERSION=20.18.0
ARG PNPM_VERSION=9.15.0
ARG APP_PORT=3742

########################################
# Base image
########################################
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
WORKDIR /app
RUN apk add --no-cache libc6-compat tini \
  && corepack enable \
  && corepack prepare pnpm@${PNPM_VERSION} --activate
ENV PNPM_HOME=/pnpm \
    PATH="$PNPM_HOME:$PATH" \
    NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p /pnpm-store

########################################
# Dependencies stage
########################################
FROM base AS deps
# Copy dependency files
COPY package.json pnpm-lock.yaml* ./
# Copy Prisma schema для postinstall
COPY src/prisma ./src/prisma
# Copy assets для build:icons
COPY src/assets ./src/assets
# Install all dependencies (включая dev) БЕЗ postinstall
RUN --mount=type=cache,target=/pnpm-store \
    pnpm install --frozen-lockfile --ignore-scripts

########################################
# Builder stage
########################################
FROM deps AS builder
# Copy source code
COPY . .
# Manually run postinstall scripts
RUN pnpm prisma generate --schema=./src/prisma/schema.prisma
RUN pnpm run build:icons
# Build application
RUN pnpm build

########################################
# Runtime stage  
########################################
FROM node:${NODE_VERSION}-alpine AS runtime
ARG APP_PORT
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache tini \
  && addgroup -g 1001 -S nodejs \
  && adduser -S nextjs -u 1001 -G nodejs

# Set environment variables
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=${APP_PORT} \
    HOSTNAME="0.0.0.0"

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:${PORT}/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" \
    || exit 1

# Expose port
EXPOSE ${APP_PORT}

# Switch to non-root user
USER nextjs

# Use tini as PID 1
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "server.js"]

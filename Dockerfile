# Dockerfile

# Multi-stage build: first build all outputs, then run a slim production runtime
FROM node:22-slim AS builder

WORKDIR /build

# Copy ALL workspace package.json files and lock first to install dependencies properly
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

# Install npm dependencies (using npm ci for deterministic builds)
RUN npm ci --ignore-scripts=false

# Copy TypeScript configuration files (needed before compilation)
COPY tsconfig.base.json ./
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/tsconfig.build.json apps/web/tsconfig.build.json
COPY packages/db/tsconfig.json packages/db/tsconfig.json
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json

# Copy source code
COPY apps/api/src apps/api/src
COPY apps/web/src apps/web/src
COPY apps/web/index.html apps/web/index.html
COPY packages/db/src packages/db/src
COPY packages/shared/src packages/shared/src

# Compile TypeScript for API, DB, Shared packages
RUN npm -w apps/api exec tsc -- --build tsconfig.json
RUN npm -w packages/db exec tsc -- --build tsconfig.json
RUN npm -w packages/shared exec tsc -- --build tsconfig.json

# Compile web TypeScript and run Vite production build
RUN npm -w apps/web exec tsc -- --build tsconfig.build.json
RUN npm -w apps/web exec vite build -- --outDir dist

# --- Runtime stage: minimal production image ---
FROM node:22-slim AS runtime

# Copy everything needed from builder

# First, copy package files and install production dependencies (including workspace resolution)
COPY --from=builder /build/package.json /app/package.json
COPY --from=builder /build/package-lock.json /app/package-lock.json
COPY --from=builder /build/apps/api/package.json /app/apps/api/package.json
COPY --from=builder /build/apps/web/package.json /app/apps/web/package.json
COPY --from=builder /build/packages/db/package.json /app/packages/db/package.json
COPY --from=builder /build/packages/shared/package.json /app/packages/shared/package.json

# Install production dependencies only (no devDeps, with workspace resolution)
RUN npm ci --ignore-scripts=false --omit=dev

# Copy built outputs (dist directories) - NOT source files
COPY --from=builder /build/apps/api/dist /app/apps/api/dist
COPY --from=builder /build/apps/web/dist /app/apps/web/dist
COPY --from=builder /build/packages/db/dist /app/packages/db/dist
COPY --from=builder /build/packages/shared/dist /app/packages/shared/dist

# Copy Docker entrypoint and env example
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
COPY .env.example /app/.env.example

# Create non-root user
RUN useradd -m -u 1000 appuser && \
    mkdir -p /data && \
    chown -R appuser:appuser /app /data

# Set environment defaults (absolute WEB_DIST path)
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_DIALECT=sqlite \
    SQLITE_PATH=/data/taskmaster.db \
    WEB_DIST=/app/apps/web/dist

# Expose port 3000
EXPOSE 3000

# Set working directory
WORKDIR /app

# Switch to non-root user
USER appuser

# Healthcheck on API health route
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

# Entrypoint: run migrations then start server
ENTRYPOINT ["/bin/bash", "/app/docker-entrypoint.sh"]
CMD ["node", "/app/apps/api/dist/server.js"]

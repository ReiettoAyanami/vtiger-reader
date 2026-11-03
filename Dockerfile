# Production image: Angular build + compiled API in one slim Node runtime.
# Build context = project root (see compose.prod.yaml).

# 1. Angular build -> /web/dist/web/browser
FROM node:22-bookworm-slim AS web
ENV NG_CLI_ANALYTICS=false
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npx ng build

# 2. API build (tsc) -> /app/dist
FROM node:22-bookworm-slim AS api-build
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/ ./
RUN npm run build

# 3. Runtime: production dependencies only, API dist, migrations, Angular build
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=api-build /app/dist ./dist
COPY api/migrations ./migrations
COPY --from=web /web/dist/web/browser ./public
ENV WEB_DIST=/app/public
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]

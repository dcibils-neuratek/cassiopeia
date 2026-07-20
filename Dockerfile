# Cassiopeia — containerized demo/dev image.
# Runs the API (:3001) and the web dev server (:5173) together via the launcher.
# For a hardened production image, build the web to static assets and serve them
# behind the API or a CDN; the SQLite data dir and secret key are the only state.
FROM node:22-slim

RUN corepack enable
WORKDIR /app

# Install deps first for better layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/model/package.json packages/model/
COPY packages/expr/package.json packages/expr/
COPY packages/engine/package.json packages/engine/
COPY packages/form-kit/package.json packages/form-kit/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .

# Persist SQLite data and the encryption key outside the image.
VOLUME ["/app/apps/api/data"]

ENV PORT=3001
EXPOSE 3001 5173

# CASSIOPEIA_SECRET_KEY should be provided at runtime in production.
CMD ["pnpm", "start"]

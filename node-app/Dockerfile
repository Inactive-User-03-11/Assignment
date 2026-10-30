# syntax=docker/dockerfile:1

ARG NODE_VERSION=24

# ---- Stage 1: install production dependencies ----
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Stage 2: runtime ----
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Bring in only the prod node_modules and the app code
COPY --from=deps /app/node_modules ./node_modules
COPY package.json index.js ./

EXPOSE 3000

# exec form + direct node (not npm start) so SIGTERM reaches the process
# and your graceful shutdown handler runs
CMD ["node", "index.js"]
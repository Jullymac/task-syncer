## Stage 1 — build
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

## Stage 2 — runtime
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

# compiled JS
COPY --from=builder /app/dist ./dist


EXPOSE 3100

CMD ["node", "dist/index.js"]

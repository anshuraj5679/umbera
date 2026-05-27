FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
RUN apk add --no-cache git python3 make g++ \
 && npm install -g pnpm@9 \
 && pnpm install --frozen-lockfile=false \
 && pnpm build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app /app
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

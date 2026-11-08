# Build the client with dev dependencies, then ship only what the server needs.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
ENV NODE_ENV=production PORT=8787
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod && pnpm store prune
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY tsconfig.json ./
USER node
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "server/index.ts"]

# Build context = repo root (needs packages/contracts).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/tsconfig/package.json ./packages/tsconfig/
RUN npm ci --workspaces --include-workspace-root
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
COPY turbo.json ./
# contracts ships as dist (web imports @traineon/contracts) — build it first.
RUN npm run build --workspace=packages/contracts
# Force mocks OFF and same-origin API (shell env overrides any .env file in Vite).
RUN VITE_ENABLE_MOCKS=false npm run build --workspace=apps/web

FROM nginx:1.27-alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

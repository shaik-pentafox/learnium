FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/tsconfig/package.json ./packages/tsconfig/

FROM base AS deps
RUN npm ci --workspaces --include-workspace-root

FROM deps AS builder
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY turbo.json ./
RUN npm run build --workspace=apps/api

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nestjs:nodejs /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=nestjs:nodejs /app/packages ./packages
USER nestjs
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

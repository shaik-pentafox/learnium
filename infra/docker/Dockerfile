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
# Generate the Prisma client (no postinstall hook exists) then compile.
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build --workspace=apps/api

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
# Carry node_modules FROM BUILDER (includes the generated Prisma client).
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages ./packages
# Schema + migrations are needed so the entrypoint can run `migrate deploy`.
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/prisma ./apps/api/prisma
COPY --chown=nestjs:nodejs infra/docker/docker-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
USER nestjs
EXPOSE 3000
# Applies pending migrations, then starts the API (api/realtime/worker by APP_ROLE).
ENTRYPOINT ["/app/entrypoint.sh"]

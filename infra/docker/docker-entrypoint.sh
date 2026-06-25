#!/bin/sh
# API container entrypoint: apply DB migrations, then boot the server.
# Migrations are idempotent (migrate deploy only runs un-applied ones), so it is
# safe to run on every container start. Only the `api` role owns migrations to
# avoid races when realtime/worker replicas start in parallel.
set -e

if [ "${APP_ROLE:-api}" = "api" ] && [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] applying migrations…"
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
fi

echo "[entrypoint] starting API (APP_ROLE=${APP_ROLE:-api})…"
exec node apps/api/dist/main.js

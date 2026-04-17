#!/bin/bash
# Preview-only `prisma migrate deploy` with retry to absorb Neon cold-start races.
# Skips on production and main branch (where preview DBs aren't relevant).
set -eu

if [ "${VERCEL_ENV:-}" != "preview" ] || \
   [ "${VERCEL_GIT_COMMIT_REF:-}" = "main" ] || \
   [ -z "${DATABASE_URL_UNPOOLED:-}" ]; then
  echo "skip migrate"
  exit 0
fi

MAX_ATTEMPTS=3
BACKOFF_SEC=10

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  if pnpm prisma migrate deploy; then
    exit 0
  fi
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    echo "migrate deploy failed (attempt $attempt/$MAX_ATTEMPTS) — retrying in ${BACKOFF_SEC}s..."
    sleep "$BACKOFF_SEC"
  fi
done

echo "migrate deploy failed after $MAX_ATTEMPTS attempts" >&2
exit 1

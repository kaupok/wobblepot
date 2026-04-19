#!/bin/bash
# Preview-only `prisma migrate deploy` with retry to absorb Neon cold-start races.
# Skips on production and main branch (where preview DBs aren't relevant).
#
# Two layers of resilience against Neon auto-suspend (builds on HON-422):
# 1. Per-attempt: append ?connect_timeout=30 to DATABASE_URL_UNPOOLED so each
#    Prisma connect call actually waits for a waking compute instead of
#    giving up in the default ~5s. This alone usually covers cold-start.
# 2. Across attempts: up to 5 retries with 15s backoff to cover edge cases
#    (branch creation mid-build, DNS propagation lag, intermittent Neon blips).
set -eu

if [ "${VERCEL_ENV:-}" != "preview" ] || \
   [ "${VERCEL_GIT_COMMIT_REF:-}" = "main" ] || \
   [ -z "${DATABASE_URL_UNPOOLED:-}" ]; then
  echo "skip migrate"
  exit 0
fi

# Idempotently extend the Prisma connect timeout so attempts wait for Neon wake.
if [[ "$DATABASE_URL_UNPOOLED" != *"connect_timeout="* ]]; then
  if [[ "$DATABASE_URL_UNPOOLED" == *"?"* ]]; then
    DATABASE_URL_UNPOOLED="${DATABASE_URL_UNPOOLED}&connect_timeout=30"
  else
    DATABASE_URL_UNPOOLED="${DATABASE_URL_UNPOOLED}?connect_timeout=30"
  fi
  export DATABASE_URL_UNPOOLED
fi

MAX_ATTEMPTS=5
BACKOFF_SEC=15

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

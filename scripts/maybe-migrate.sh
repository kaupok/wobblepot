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

# Fail-fast pre-flight: verify the endpoint host in DATABASE_URL_UNPOOLED
# actually exists in the Neon project. Catches the case where Vercel's env var
# is pinned to a reaped endpoint (see HON-492), avoiding 5 rounds of P1001
# noise in favour of one clear diagnostic. Soft-skip when either Neon env var
# is unset so local/self-hosted paths are unaffected.
if [ -n "${NEON_API_KEY:-}" ] && [ -n "${NEON_PROJECT_ID:-}" ]; then
  host="${DATABASE_URL_UNPOOLED#*@}"
  host="${host%%/*}"
  host="${host%%:*}"
  endpoint_id="${host%%.*}"
  # Neon's pooled host is `<endpoint-id>-pooler.<region>…`; the API's canonical
  # endpoint id has no `-pooler` suffix. Normalise so a pooled URL accidentally
  # landing in DATABASE_URL_UNPOOLED doesn't false-positive as "not present".
  endpoint_id="${endpoint_id%-pooler}"

  if [[ "$endpoint_id" =~ ^ep-[a-z0-9-]+$ ]]; then
    endpoints_response=$(curl -sS --max-time 5 \
      -H "Authorization: Bearer $NEON_API_KEY" \
      -H "Accept: application/json" \
      "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/endpoints" 2>/dev/null || true)

    if [ -n "$endpoints_response" ] && echo "$endpoints_response" | grep -qE '"endpoints"[[:space:]]*:'; then
      if ! echo "$endpoints_response" | grep -qE "\"id\"[[:space:]]*:[[:space:]]*\"${endpoint_id}\""; then
        cat >&2 <<EOF
Endpoint ${endpoint_id} is not present in Neon project ${NEON_PROJECT_ID}.
Vercel env var for this preview is stale — re-trigger the Vercel-Neon
integration (delete + recreate the preview branch) or update the env
var manually.
EOF
        exit 1
      fi
      echo "neon pre-flight: endpoint ${endpoint_id} confirmed in project ${NEON_PROJECT_ID}" >&2
    else
      echo "neon pre-flight: could not reach Neon API, skipping check" >&2
    fi
  fi
else
  echo "neon pre-flight: skipped (NEON_API_KEY or NEON_PROJECT_ID not set)" >&2
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

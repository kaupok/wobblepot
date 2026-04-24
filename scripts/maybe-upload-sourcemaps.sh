#!/bin/bash
# Upload Next.js browser source maps to PostHog after a production Vercel
# build. No-op unless both gate env vars are set — local `pnpm build` stays
# silent and fast.
#
# Two-step flow (both required):
#   1. `sourcemap inject`: embeds release metadata into .map files so PostHog
#      can correlate minified frames back to source. Skipping this makes the
#      upload succeed while stack traces arrive un-symbolized.
#   2. `sourcemap upload`: pushes the injected maps to the PostHog project
#      resolved from POSTHOG_CLI_PROJECT_ID. Filters out chunks >10MB to
#      avoid the CLI's 413 Payload Too Large failure mode.
#
# Depends on `next.config.ts` having `productionBrowserSourceMaps: true`
# (without it, no .map files are emitted and both steps walk empty dirs).
set -euo pipefail

if [ -z "${VERCEL_GIT_COMMIT_SHA:-}" ] || [ -z "${POSTHOG_CLI_API_KEY:-}" ]; then
  echo "maybe-upload-sourcemaps: skip (VERCEL_GIT_COMMIT_SHA or POSTHOG_CLI_API_KEY unset)"
  exit 0
fi

CHUNKS_DIR=".next/static/chunks"
if [ ! -d "$CHUNKS_DIR" ]; then
  echo "maybe-upload-sourcemaps: skip (no $CHUNKS_DIR after build)"
  exit 0
fi

POSTHOG_CLI_VERSION="0.1.6"

echo "maybe-upload-sourcemaps: injecting release metadata into $CHUNKS_DIR"
pnpm dlx "posthog-cli@${POSTHOG_CLI_VERSION}" sourcemap inject \
  --directory "$CHUNKS_DIR"

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

FILTERED_DIR="$TEMP_DIR/chunks"
mkdir -p "$FILTERED_DIR"

# Copy chunks + their paired .map files under 10MB into the filtered dir.
# Chunks over the limit trigger 413s; skipping them costs symbolization
# only for the oversized bundles, which is strictly better than failing
# the whole upload.
while IFS= read -r file; do
  rel="${file#"$CHUNKS_DIR"/}"
  dest="$FILTERED_DIR/$rel"
  mkdir -p "$(dirname "$dest")"
  cp "$file" "$dest"
done < <(find "$CHUNKS_DIR" -type f -size -10M \( -name "*.js" -o -name "*.map" \))

echo "maybe-upload-sourcemaps: uploading to PostHog (release=$VERCEL_GIT_COMMIT_SHA)"
pnpm dlx "posthog-cli@${POSTHOG_CLI_VERSION}" sourcemap upload \
  --directory "$FILTERED_DIR" \
  --release-name honkadori \
  --release-version "$VERCEL_GIT_COMMIT_SHA"

echo "maybe-upload-sourcemaps: done"

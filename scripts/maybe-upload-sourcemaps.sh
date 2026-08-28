#!/bin/bash
# Upload Next.js browser source maps to PostHog after a production Vercel
# build. No-op unless both gate env vars are set — local `pnpm build` stays
# silent and fast.
#
# Uses PostHog's official CLI (`@posthog/cli`, published by PostHog Inc.).
# The unscoped `posthog-cli` package on npm is a community fork with no
# `sourcemap` subcommand — do not swap it back.
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

if [ -z "${VERCEL_GIT_COMMIT_SHA:-}" ] \
  || [ -z "${POSTHOG_CLI_API_KEY:-}" ] \
  || [ -z "${POSTHOG_CLI_HOST:-}" ] \
  || [ -z "${POSTHOG_CLI_PROJECT_ID:-}" ]; then
  echo "maybe-upload-sourcemaps: skip (need VERCEL_GIT_COMMIT_SHA, POSTHOG_CLI_API_KEY, POSTHOG_CLI_HOST, POSTHOG_CLI_PROJECT_ID)"
  exit 0
fi

CHUNKS_DIR=".next/static/chunks"
if [ ! -d "$CHUNKS_DIR" ]; then
  echo "maybe-upload-sourcemaps: skip (no $CHUNKS_DIR after build)"
  exit 0
fi

POSTHOG_CLI_PACKAGE="@posthog/cli@0.7.10"

echo "maybe-upload-sourcemaps: injecting release metadata into $CHUNKS_DIR"
pnpm dlx "$POSTHOG_CLI_PACKAGE" --host "$POSTHOG_CLI_HOST" sourcemap inject \
  --directory "$CHUNKS_DIR"

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

FILTERED_DIR="$TEMP_DIR/chunks"
mkdir -p "$FILTERED_DIR"

# Copy chunks + their paired .map files under 10MB into the filtered dir.
# Chunks over the limit trigger 413s; skipping them costs symbolization
# only for the oversized bundles, which is strictly better than failing
# the whole upload.
#
# Piped rather than `done < <(find ...)`: process substitution needs /dev/fd,
# which is intermittently absent in Vercel's build container and fails with
# "/dev/fd/63: No such file or directory" (took out the 29f980a staging deploy
# and several previews on 2026-08-27). Nothing after the loop needs variables
# set inside it, so the subshell a pipe implies is harmless.
find "$CHUNKS_DIR" -type f -size -10M \( -name "*.js" -o -name "*.map" \) -print0 \
  | while IFS= read -r -d '' file; do
      rel="${file#"$CHUNKS_DIR"/}"
      dest="$FILTERED_DIR/$rel"
      mkdir -p "$(dirname "$dest")"
      cp "$file" "$dest"
    done

echo "maybe-upload-sourcemaps: uploading to PostHog (release=$VERCEL_GIT_COMMIT_SHA)"
pnpm dlx "$POSTHOG_CLI_PACKAGE" --host "$POSTHOG_CLI_HOST" sourcemap upload \
  --directory "$FILTERED_DIR" \
  --release-name honkadori \
  --release-version "$VERCEL_GIT_COMMIT_SHA"

echo "maybe-upload-sourcemaps: done"

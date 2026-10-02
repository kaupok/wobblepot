#!/bin/bash
# Upload Next.js browser source maps to PostHog during a Vercel build, then
# delete them so they are not served. No-op unless all four gate env vars are
# set, so a local `pnpm build` stays silent and fast.
#
# Usage: maybe-upload-sourcemaps.sh [distDir]   (default .next)
#
# Called from `compiler.runAfterProductionCompile` in next.config.ts
# (src/lib/posthog-sourcemaps.ts), not from `postbuild`. On Vercel the Next.js
# adapter copies `.next/static` into the deployment output inside `next build`,
# so by `postbuild` the deployed files are already fixed: an inject there never
# ships and a delete there never removes a served map (HON-997).
#
# Uses PostHog's official CLI (`@posthog/cli`, published by PostHog Inc.).
# The unscoped `posthog-cli` package on npm is a community fork with no
# `sourcemap` subcommand — do not swap it back.
#
# Two-step flow (both required):
#   1. `sourcemap inject`: embeds a chunk id and the release into each chunk and
#      its map, so PostHog can match a minified frame to its symbol set.
#   2. `sourcemap upload`: pushes the maps to the PostHog project resolved from
#      POSTHOG_CLI_PROJECT_ID, then deletes them and strips the
#      `sourceMappingURL` comments (`--delete-after`).
#
# Depends on `next.config.ts` having `productionBrowserSourceMaps: true`
# (without it, no .map files are emitted and this script fails).
set -euo pipefail

DIST_DIR="${1:-.next}"

if [ -z "${VERCEL_GIT_COMMIT_SHA:-}" ] \
  || [ -z "${POSTHOG_CLI_API_KEY:-}" ] \
  || [ -z "${POSTHOG_CLI_HOST:-}" ] \
  || [ -z "${POSTHOG_CLI_PROJECT_ID:-}" ]; then
  echo "maybe-upload-sourcemaps: skip (need VERCEL_GIT_COMMIT_SHA, POSTHOG_CLI_API_KEY, POSTHOG_CLI_HOST, POSTHOG_CLI_PROJECT_ID)"
  exit 0
fi

# From here on the build is meant to upload, so every missing piece is an
# error. A silent skip on the chunks check hid a broken upload for five months.
#
# With immutable assets on, Turbopack writes chunks to static/immutable/chunks
# and Vercel serves them from a store shared across deployments, keyed by a
# hash taken before inject. The deploy would serve an older build's chunks, so
# an upload here would look fine and symbolize nothing. next.config.ts sets
# `supportsImmutableAssets: false`; this guards against that line going away.
if [ -d "$DIST_DIR/static/immutable" ]; then
  echo "maybe-upload-sourcemaps: error: $DIST_DIR/static/immutable exists. Set supportsImmutableAssets: false in next.config.ts (HON-997)" >&2
  exit 1
fi
CHUNKS_DIR="$DIST_DIR/static/chunks"
if [ ! -d "$CHUNKS_DIR" ]; then
  echo "maybe-upload-sourcemaps: error: no $CHUNKS_DIR after compile" >&2
  exit 1
fi

MAP_COUNT=$(find "$CHUNKS_DIR" -type f -name '*.map' | wc -l | tr -d ' ')
if [ "$MAP_COUNT" -eq 0 ]; then
  echo "maybe-upload-sourcemaps: error: no .map files in $CHUNKS_DIR (is productionBrowserSourceMaps on?)" >&2
  exit 1
fi

POSTHOG_CLI_PACKAGE="@posthog/cli@0.18.9"

# Both steps get the same release. `inject` stamps it, and without these flags
# it derives one from git, which need not match what `upload` passes.
# `--release-mode symbol-set` binds the release to the uploaded symbol sets,
# as the CLI did by default before 0.18.0. From 0.18.0 the default is `event`:
# symbol sets stay unbound and each exception reads its release from the chunk.
# Moving to `event` is a behaviour change; make it on purpose, not by bumping.
RELEASE_ARGS=(
  --release-name honkadori
  --release-version "$VERCEL_GIT_COMMIT_SHA"
  --release-mode symbol-set
)

echo "maybe-upload-sourcemaps: injecting release metadata into $CHUNKS_DIR ($MAP_COUNT maps)"
pnpm dlx "$POSTHOG_CLI_PACKAGE" --host "$POSTHOG_CLI_HOST" sourcemap inject \
  --directory "$CHUNKS_DIR" \
  "${RELEASE_ARGS[@]}"

UPLOAD_LOG=$(mktemp)
trap 'rm -f "$UPLOAD_LOG"' EXIT

# The CLI skips chunks it cannot upload (too large) and reports them in its
# summary, so there is no size pre-filter here. `tee` prints the CLI output as
# it runs; pipefail still fails the script when the CLI exits non-zero.
echo "maybe-upload-sourcemaps: uploading to PostHog (release=$VERCEL_GIT_COMMIT_SHA)"
pnpm dlx "$POSTHOG_CLI_PACKAGE" --host "$POSTHOG_CLI_HOST" sourcemap upload \
  --directory "$CHUNKS_DIR" \
  --delete-after \
  "${RELEASE_ARGS[@]}" 2>&1 | tee "$UPLOAD_LOG"

# A zero exit is not proof of an upload, so read the CLI's own tally:
#   Upload summary: N chunk(s) uploaded, M skipped (A already present, B too large)
# "Already present" counts too: a rebuild of the same commit uploads nothing new.
SUMMARY=$(grep -oE 'Upload summary: [0-9]+ chunk\(s\) uploaded, [0-9]+ skipped \([0-9]+ already present' "$UPLOAD_LOG" | tail -1 || true)
if [ -z "$SUMMARY" ]; then
  echo "maybe-upload-sourcemaps: error: the CLI printed no upload summary, so the upload is unconfirmed" >&2
  exit 1
fi
UPLOADED=$(printf '%s\n' "$SUMMARY" | sed -E 's/.*: ([0-9]+) chunk.*/\1/')
PRESENT=$(printf '%s\n' "$SUMMARY" | sed -E 's/.*\(([0-9]+) already present/\1/')
if [ $((UPLOADED + PRESENT)) -eq 0 ]; then
  echo "maybe-upload-sourcemaps: error: PostHog reports no symbol set for this build ($SUMMARY)" >&2
  exit 1
fi

# `--delete-after` keeps a map whose chunk the CLI skipped. Delete what is left
# anywhere under static/, so no map is served.
LEFTOVER=$(find "$DIST_DIR/static" -type f -name '*.map' | wc -l | tr -d ' ')
find "$DIST_DIR/static" -type f -name '*.map' -delete
echo "maybe-upload-sourcemaps: done ($UPLOADED uploaded, $PRESENT already present, $LEFTOVER leftover maps deleted)"

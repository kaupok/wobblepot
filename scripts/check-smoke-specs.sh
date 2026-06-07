#!/usr/bin/env bash
# Guardrail (HON-560): @smoke specs run against shared staging, where the
# test-only /api/e2e-seed route 404s by design (rate-limit bypass is never
# active there — see src/app/api/e2e-seed/route.ts). Any @smoke spec that
# signs up a fresh account therefore fails structurally, regardless of app
# health, and turns the production-promotion gate red on every merge.
#
# This script fails when a @smoke-tagged spec file references one of the
# seed-dependent helpers. The check is file-scoped, which is why the
# staging-safe @smoke specs live in their own file (tests/e2e/smoke.spec.ts)
# instead of sharing auth.spec.ts with the fresh-signup tests.
#
# Run in CI on every PR (catches violations before merge) and as a fail-fast
# step in staging-smoke (catches drift in the workflow itself).
set -eu

# Helpers that ultimately POST /api/e2e-seed: seedInviteCode() directly,
# signUp()/signUpWithHousehold() via the invite-code auto-seed.
FORBIDDEN='seedInviteCode\(|signUp\(|signUpWithHousehold\('

# A spec "carries @smoke" when a Playwright tag declaration says so —
# `{ tag: '@smoke' }` or `{ tag: ['@smoke', ...] }` — not when a comment
# merely mentions the tag. Tag declarations are single-line by convention
# in this repo; keep them that way or this check goes blind.
TAG_PATTERN="tag:.*['\"]@smoke['\"]"

status=0
for spec in tests/e2e/*.spec.ts; do
  grep -qE "$TAG_PATTERN" "$spec" || continue
  # Drop comment lines (// or *) so prose mentioning the helpers doesn't trip.
  matches=$(grep -nE "$FORBIDDEN" "$spec" | grep -vE '^[0-9]+:[[:space:]]*(//|\*)' || true)
  if [ -n "$matches" ]; then
    echo "ERROR: $spec is tagged @smoke but uses seed-dependent helpers:" >&2
    echo "$matches" >&2
    echo "@smoke specs must follow pattern (b) — immutable seeded fixtures," >&2
    echo "no /api/e2e-seed. See tests/e2e/README.md → 'The @smoke tag'." >&2
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "check-smoke-specs: OK — no @smoke spec uses /api/e2e-seed helpers"
fi
exit "$status"

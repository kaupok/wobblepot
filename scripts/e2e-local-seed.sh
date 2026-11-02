# shellcheck shell=bash
# Sourced by scripts/e2e-local.sh, never run on its own: it uses that script's
# info/fail, $BRANCH and $REPO_ROOT.
#
# Seeds the database `run` and `serve --seed` point at. Smoke-fixture specs
# skip (exit 0) without fixture credentials, which CI holds as secrets and a
# local .env does not, so a throwaway branch gets the seed's defaults (HON-1594).

# Export the seed's default fixture credentials (prisma/seed-test-user-defaults.ts)
# for each one the shell has not set, so seed and Playwright agree on them.
export_seed_test_user_defaults() {
  local defaults key value
  defaults="$(pnpm exec tsx "$REPO_ROOT/scripts/print-seed-test-user-defaults.ts")" \
    || fail "Could not read the seed's default fixture credentials."
  while IFS='=' read -r key value; do
    [ -n "$key" ] || continue
    if [ -z "${!key:-}" ]; then export "$key=$value"; fi
  done <<< "$defaults"
  [ -n "${SMOKE_TEST_EMAIL:-}" ] || fail "The seed's default fixture credentials have no SMOKE_TEST_EMAIL."
}

run_seed() {
  # A throwaway branch gets the seed's default for each fixture credential the
  # shell leaves unset, so fixture specs run instead of skipping (HON-1594) and
  # seed and Playwright agree on a half-set pair. The .env database gets fixture
  # users only when the shell or .env holds the credentials, as in CI.
  if [ -n "$BRANCH" ]; then export_seed_test_user_defaults; fi
  # The base meal/translation seed always runs.
  if [ -n "${SMOKE_TEST_EMAIL:-}" ]; then export SEED_TEST_USERS="1"; fi

  # The seed reads DATABASE_URL from this process, which is the branch in branch
  # mode and .env's value in env mode (load_env exports it over the shell's).
  if [ -n "$BRANCH" ]; then info "Seeding the ephemeral branch…"; else info "Seeding the .env database…"; fi
  pnpm db:seed
}

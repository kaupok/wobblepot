# shellcheck shell=bash
# Sourced by scripts/e2e-local.sh, never run on its own: it uses that script's
# info/fail and runs from the repo root, where e2e-local.sh has cd'd.
#
# Brings the local toolchain in line with the checkout before `run` or `serve`
# starts the dev server (HON-1315). After a dependency update, every browser
# spec failed in 1 ms on a missing Chromium build; after a `git pull` with a
# new model, a stale Prisma client made plan reads answer 500. Both looked like
# a regression. CI never sees either, because it installs everything per run.
#
# Each step acts only when its input is newer than its output, so a current
# checkout pays one Playwright dry run (under a second). cmd_run and cmd_serve
# call this before create_branch, so a failing step leaves no Neon branch.

# True when $1 is missing or older than $2.
older_than() { [ ! -e "$1" ] || [ "$2" -nt "$1" ]; }

# The Playwright install directories for Chromium (and what it needs, such as
# ffmpeg) that are not fully installed; Playwright writes INSTALLATION_COMPLETE
# last. Prints nothing when all are there. A dry run that fails or names no
# directory prints a reason instead, so a changed output format installs rather
# than skips.
missing_browsers() {
  local out dirs dir
  out="$(pnpm exec playwright install --dry-run chromium 2>/dev/null)" || { echo "(dry run failed)"; return 0; }
  dirs="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*Install location:[[:space:]]*//p')"
  [ -n "$dirs" ] || { echo "(dry run named no install location)"; return 0; }
  while IFS= read -r dir; do
    [ -e "$dir/INSTALLATION_COMPLETE" ] || echo "$dir"
  done <<< "$dirs"
}

# Step output goes to stderr with the progress lines, so stdout keeps only the
# REVIEW-READY marker an agent waits on.
prepare_toolchain() {
  if older_than node_modules/.modules.yaml pnpm-lock.yaml; then
    info "pnpm-lock.yaml is newer than node_modules — installing dependencies…"
    pnpm install --frozen-lockfile >&2 || fail "toolchain step 'pnpm install --frozen-lockfile' failed."
  fi
  # Checked after the install, because its postinstall regenerates the client.
  if older_than src/generated/prisma/client.ts prisma/schema.prisma; then
    info "prisma/schema.prisma is newer than the generated client — regenerating it…"
    pnpm db:generate >&2 || fail "toolchain step 'pnpm db:generate' failed."
  fi
  if [ -n "$(missing_browsers)" ]; then
    info "Installing the Chromium build this Playwright version needs…"
    pnpm exec playwright install chromium >&2 || fail "toolchain step 'pnpm exec playwright install chromium' failed."
  fi
}

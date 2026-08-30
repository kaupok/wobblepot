#!/usr/bin/env bash
# Run the Playwright E2E suite locally against an ISOLATED, ephemeral Neon
# branch — never your shared dev DATABASE_URL.
#
# Why this exists: plain `pnpm test:e2e` boots `pnpm dev`, which loads .env and
# talks to your real dev database. Every sign-up / household / meal plan a spec
# creates lands there permanently (specs use unique emails, so the cruft is
# invisible but real). This wrapper instead forks a throwaway Neon branch off
# $NEON_PARENT_BRANCH (default: staging), applies migrations, seeds it, runs
# Playwright against a dedicated dev server on its own port, then deletes the
# branch on exit. Local E2E becomes reproducible and side-effect-free, and it
# works for the @ai specs too (real Claude calls, isolated data).
#
# Usage:
#   pnpm test:e2e:local                          # all specs EXCEPT @ai (cost-safe default)
#   pnpm test:e2e:local tests/e2e/foo.spec.ts    # one spec (runs @ai if that spec is tagged)
#   pnpm test:e2e:local --ai                     # the whole suite INCLUDING @ai specs
#   pnpm test:e2e:local --keep                   # leave the branch alive for debugging
#   pnpm test:e2e:local -- --headed --debug      # forward args after `--` to playwright
#   pnpm test:e2e:local gc                        # delete orphaned e2e-local-* branches (crash recovery)
#
# Recognised flags: --ai, --keep, gc. A `.spec.ts` path or `--grep` is treated
# as an explicit target (so @ai is NOT excluded). Anything after a literal `--`,
# and any unrecognised arg, is forwarded to `playwright test` verbatim.
#
# Requires NEON_API_KEY + NEON_PROJECT_ID in .env (already set for the worktree
# workflow — see docs/PARALLEL_WORKFLOW.md). @ai specs additionally need
# ANTHROPIC_API_KEY (also in .env).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Keep in lockstep with scripts/worktree-claude.sh — both pin the same neonctl.
NEONCTL_VERSION="2.22.0"
BRANCH_PREFIX="e2e-local"
# Env-tunable knobs (E2E_LOCAL_PORT, E2E_GC_MIN_AGE_HOURS) are re-resolved in
# resolve_config() *after* load_env, so a value set in .env takes effect too —
# not only a shell-exported one (mirrors how NEON_* / SMOKE_* are read). The
# values here are the fallback defaults.
PORT="3100"
# Age gate for `gc` so a concurrent run's fresh branch is never reaped.
GC_MIN_AGE_HOURS="2"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
log()  { printf '%s\n' "$*" >&2; }
info() { printf '%b\n' "${GREEN}$*${NC}" >&2; }
warn() { printf '%b\n' "${YELLOW}warn: $*${NC}" >&2; }
fail() { printf '%b\n' "${RED}error: $*${NC}" >&2; exit 1; }

neon() { pnpm dlx "neonctl@$NEONCTL_VERSION" "$@"; }

# Defense-in-depth: never create or delete a protected branch, however named.
is_protected() { case "$1" in staging|main|production|preview) return 0 ;; *) return 1 ;; esac; }

# Portable ISO-8601 → unix epoch (BSD date on macOS, GNU date on Linux).
iso_to_epoch() {
  local ts="${1%.*Z}"; ts="${ts%Z}"
  date -u -d "$ts" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%S' "$ts" +%s 2>/dev/null || echo 0
}

load_env() {
  if [ -f "$REPO_ROOT/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$REPO_ROOT/.env"
    set +a
  fi
}

# Re-resolve env-tunable config AFTER load_env so .env values win over the
# top-level defaults. Must be called once at the start of each command.
resolve_config() {
  PORT="${E2E_LOCAL_PORT:-$PORT}"
  GC_MIN_AGE_HOURS="${E2E_GC_MIN_AGE_HOURS:-$GC_MIN_AGE_HOURS}"
}

require_neon() {
  { [ -n "${NEON_API_KEY:-}" ] && [ -n "${NEON_PROJECT_ID:-}" ]; } || fail \
    "NEON_API_KEY and NEON_PROJECT_ID must be set in .env (this runner isolates each run on its own Neon branch). See docs/PARALLEL_WORKFLOW.md § Neon Database Branching."
}

# State shared with the EXIT trap.
POOLED=""; UNPOOLED=""; BRANCH=""; KEEP=0

# Delete e2e-local-* branches older than GC_MIN_AGE_HOURS. Used both as
# crash-recovery (`gc` subcommand) and to reclaim space on a branch-cap error.
gc_orphans() {
  local list now name id updated epoch age
  list="$(neon branches list --project-id "$NEON_PROJECT_ID" --output json 2>/dev/null)" \
    || { warn "branches list failed — skipping GC"; return 0; }
  now="$(date -u +%s)"
  # Shape-tolerant: accept either a bare array or {"branches": [...]}.
  while IFS=$'\t' read -r id name updated; do
    [ -n "$id" ] || continue
    is_protected "$name" && continue
    epoch="$(iso_to_epoch "$updated")"
    age=$(( (now - epoch) / 3600 ))
    if [ "$epoch" -gt 0 ] && [ "$age" -lt "$GC_MIN_AGE_HOURS" ]; then
      log "GC: keeping '$name' (age ${age}h < ${GC_MIN_AGE_HOURS}h)"
      continue
    fi
    info "GC: deleting orphaned '$name'"
    neon branches delete "$name" --project-id "$NEON_PROJECT_ID" >/dev/null 2>&1 || true
  done < <(echo "$list" | jq -r '
    (if type == "array" then .[] elif .branches then .branches[] else empty end)
    | select(.name | startswith("'"$BRANCH_PREFIX"'-"))
    | [.id, .name, (.updated_at // .created_at // "")] | @tsv')
}

delete_branch() {
  local b="$1"
  [ -n "$b" ] || return 0
  if is_protected "$b"; then warn "refusing to delete protected branch '$b'"; return 0; fi
  if neon branches delete "$b" --project-id "$NEON_PROJECT_ID" >/dev/null 2>&1; then
    info "Deleted Neon branch '$b'."
  else
    warn "could not delete '$b' (already gone?). Run 'pnpm test:e2e:local gc' to sweep orphans."
  fi
}

on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if [ -z "$BRANCH" ]; then
    :
  elif [ "$KEEP" = "1" ]; then
    warn "--keep set: leaving branch '$BRANCH' alive for debugging."
    log "  DATABASE_URL=$POOLED"
    log "  Delete it later with: pnpm test:e2e:local gc   (or via the Neon dashboard)"
  else
    delete_branch "$BRANCH"
  fi
  exit "$rc"
}

create_branch() {
  local parent="${NEON_PARENT_BRANCH:-staging}"
  BRANCH="${BRANCH_PREFIX}-$(date -u +%Y%m%d-%H%M%S)-$$"
  is_protected "$BRANCH" && fail "refusing to use protected branch name '$BRANCH'"

  info "Creating ephemeral Neon branch '$BRANCH' (forked from '$parent')…"
  local out
  if ! out="$(neon branches create --project-id "$NEON_PROJECT_ID" --name "$BRANCH" --parent "$parent" --output json 2>&1)"; then
    # Cap error → GC stale e2e-local-* branches and retry once. The regex needs
    # "branch" near an exhaustion keyword so a plain rate-limit reply (which GC
    # can't help) doesn't trigger a pointless sweep.
    if echo "$out" | grep -qi "branch" && echo "$out" | grep -qiE "limit|quota|cap|exceed|maximum"; then
      warn "Neon branch cap hit — GC'ing orphaned ${BRANCH_PREFIX}-* branches and retrying…"
      gc_orphans
      out="$(neon branches create --project-id "$NEON_PROJECT_ID" --name "$BRANCH" --parent "$parent" --output json 2>&1)" \
        || { log "$out"; fail "Neon branch create failed after GC (cap still exceeded?)."; }
    else
      log "$out"; fail "Neon branch create failed."
    fi
  fi

  POOLED="$(neon connection-string "$BRANCH" --project-id "$NEON_PROJECT_ID" --pooled 2>/dev/null)"
  UNPOOLED="$(neon connection-string "$BRANCH" --project-id "$NEON_PROJECT_ID" 2>/dev/null)"
  if [ -z "$POOLED" ] || [ -z "$UNPOOLED" ]; then
    delete_branch "$BRANCH"; BRANCH=""
    fail "branch created but could not fetch connection strings."
  fi
}

cmd_gc() {
  load_env; resolve_config; require_neon
  info "Sweeping orphaned ${BRANCH_PREFIX}-* Neon branches older than ${GC_MIN_AGE_HOURS}h…"
  gc_orphans
  info "GC complete."
}

cmd_run() {
  load_env; resolve_config; require_neon

  local include_ai=0 has_target=0
  local passthrough=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --ai)   include_ai=1 ;;
      --keep) KEEP=1 ;;
      --)     shift; passthrough+=("$@"); break ;;
      *.spec.ts)         has_target=1; passthrough+=("$1") ;;
      -g|--grep|--grep=*) has_target=1; passthrough+=("$1") ;;
      *)      passthrough+=("$1") ;;
    esac
    shift
  done

  trap on_exit EXIT INT TERM
  create_branch

  # The app runtime AND the seed script (prisma/seed.ts) read DATABASE_URL
  # (pooled); `prisma migrate` reads DATABASE_URL_UNPOOLED (see prisma.config.ts).
  # Both point at the same branch, so exporting both covers every consumer.
  export DATABASE_URL="$POOLED"
  export DATABASE_URL_UNPOOLED="$UNPOOLED"
  export NEXT_PUBLIC_APP_ENV="test"
  # Bypass the IP rate limiter AND enable /api/e2e-seed (the invite-code minter
  # sign-up needs). Permitted because NEXT_PUBLIC_APP_ENV is a SAFE_ENV.
  export E2E_DISABLE_RATE_LIMIT="1"
  # Log per-step sign-up timings (hibp / scrypt / invite-code / total) so the
  # latency that intermittently blows the 30s budget is measurable (HON-569).
  export SIGNUP_TIMING_LOG="1"
  # Tells playwright.config.ts to start its own dev server on this port (never
  # reusing a stale :3000 server that would point at your real DB).
  export E2E_LOCAL_PORT="$PORT"
  # Better Auth derives baseURL + trustedOrigins from NEXT_PUBLIC_APP_URL
  # (fallback localhost:3000). Pin it to the test port so CSRF origin checks
  # don't reject sign-up on :$PORT. See src/lib/env.ts getServerBaseURL().
  export NEXT_PUBLIC_APP_URL="http://localhost:$PORT"
  # Seed the smoke fixtures only when their credentials are present (they live
  # in CI secrets, not local .env). The base meal/translation seed always runs.
  [ -n "${SMOKE_TEST_EMAIL:-}" ] && export SEED_TEST_USERS="1"

  info "Applying migrations to the ephemeral branch…"
  pnpm prisma migrate deploy

  info "Seeding the ephemeral branch…"
  pnpm db:seed

  local grep_args=()
  if [ "$include_ai" = "0" ] && [ "$has_target" = "0" ]; then
    grep_args=(--grep-invert=@ai)
    log "Excluding @ai specs (pass a spec path or --ai to include them)."
  fi

  info "Running Playwright on http://localhost:$PORT against branch '$BRANCH'…"
  # bash 3.2 (macOS default) errors on "${empty[@]}" under `set -u`; the
  # "${arr[@]+...}" guard expands to nothing when the array is empty.
  pnpm exec playwright test "${grep_args[@]+"${grep_args[@]}"}" "${passthrough[@]+"${passthrough[@]}"}"
}

# Print the header comment block (everything between the shebang and the first
# non-comment line), stripped of the leading "# ".
usage() { awk 'NR==1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; }

main() {
  case "${1:-run}" in
    gc)               shift; cmd_gc "$@" ;;
    -h|--help|help)   usage ;;
    # `${1:-run}` also matches an empty argv, where a bare `shift` returns 1
    # and `set -e` aborts before anything runs — so only shift a real "run".
    run)              if [ $# -gt 0 ]; then shift; fi; cmd_run "$@" ;;
    *)                cmd_run "$@" ;;
  esac
}

main "$@"

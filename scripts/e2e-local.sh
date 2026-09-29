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
# Review server (`serve`) — the same isolated environment, but instead of
# running Playwright it leaves `next dev` up for a browser review of sign-up
# and onboarding (HON-851). See docs/CHROME_TESTING.md → "Reviewing sign-up
# and onboarding".
#   pnpm review:local                            # ephemeral Neon branch, migrations, no seed
#   pnpm review:local --seed                     # also run `pnpm db:seed` on the branch
#   pnpm review:local --db env                   # no branch: use DATABASE_URL from .env
#                                                # (for when the Neon branch cap is full)
#
# serve listens on REVIEW_LOCAL_PORT (default 3200) and prints one line
# containing `REVIEW-READY http://localhost:<port>` once the server answers.
# Stop it with Ctrl-C or `kill`; branch mode deletes its branch on the way out.
# `--db env` never creates a branch and never migrates: it checks
# `prisma migrate status` and refuses to start on a database that is behind.
# Accounts created in `--db env` mode persist — clean them up afterwards.
#
# Requires NEON_API_KEY + NEON_PROJECT_ID in .env (already set for the worktree
# workflow — see docs/PARALLEL_WORKFLOW.md), except `serve --db env`. @ai specs
# additionally need ANTHROPIC_API_KEY (also in .env).
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
# `serve` gets its own port: a queue worker may be running `pnpm test:e2e:local`
# on 3100 at the same time, and `pnpm dev` holds 3000.
REVIEW_PORT="3200"
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

# Read KEY=VALUE pairs out of an env file and export them.
#
# Deliberately duplicated from scripts/worktree-claude.sh, which this script
# does not source — keep the two in step. Parsed, never sourced: `source`
# executes the file as shell, so `FOO=$(rm -rf ~)` was a working command rather
# than a parse error, and the `set -a` that wrapped it marked every assignment
# the file made for export (HON-580). See worktree-claude.sh's copy for the
# full rationale; the parse mirrors what `source` did with a well-formed line,
# including .env winning over the calling shell.
load_env_file() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0

  local line key value quote cont
  # `|| [ -n "$line" ]` so a final line with no trailing newline is still read.
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"                      # tolerate CRLF
    line="${line#"${line%%[![:space:]]*}"}"   # trim leading whitespace
    case "$line" in
      '' | '#'*) continue ;;
      # Both spellings `source` accepted. Matching only a literal `export `
      # would drop a tab-indented line with no diagnostic at all.
      'export '* | $'export\t'*)
        line="${line#export}"
        line="${line#"${line%%[![:space:]]*}"}"
        ;;
    esac

    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

    # Trim before inspecting quotes, so a value quoted for the sake of a
    # deliberate trailing space still keeps it.
    value="${value%"${value##*[![:space:]]}"}"

    quote=""
    case "$value" in
      '"'*) quote='"' ;;
      "'"*) quote="'" ;;
    esac

    if [ -n "$quote" ]; then
      # An unclosed quote continues onto the next line, as `source` read it.
      # `read` here draws from the same redirect as the loop, so the
      # continuation is consumed rather than re-parsed as its own assignment.
      # Bounded by EOF: an unterminated value simply runs out of lines.
      while [ "${#value}" -lt 2 ] || [ "${value: -1}" != "$quote" ]; do
        IFS= read -r cont || break
        cont="${cont%$'\r'}"
        value="$value"$'\n'"${cont%"${cont##*[![:space:]]}"}"
      done
      # One matched pair only. A quote left unterminated at EOF is kept in the
      # value: better a visibly malformed string than a plausible wrong one.
      if [ "${#value}" -ge 2 ] && [ "${value: -1}" = "$quote" ]; then
        value="${value:1:${#value}-2}"
      fi
    else
      # `source` started a comment at a whitespace-preceded `#`. Requiring the
      # whitespace is what keeps a `#` inside a value (`p@ss#word`) intact.
      case "$value" in
        *[[:space:]]'#'*) value="${value%%[[:space:]]'#'*}" ;;
      esac
      value="${value%"${value##*[![:space:]]}"}"
    fi

    # `|| true` because the script runs under `set -e`: a readonly name in .env
    # would otherwise abort the dispatcher before it reaches the command router.
    export "$key=$value" 2> /dev/null || true
  done < "$env_file"
}

load_env() {
  load_env_file "$REPO_ROOT/.env"
}

# Re-resolve env-tunable config AFTER load_env so .env values win over the
# top-level defaults. Must be called once at the start of each command.
resolve_config() {
  PORT="${E2E_LOCAL_PORT:-$PORT}"
  REVIEW_PORT="${REVIEW_LOCAL_PORT:-$REVIEW_PORT}"
  GC_MIN_AGE_HOURS="${E2E_GC_MIN_AGE_HOURS:-$GC_MIN_AGE_HOURS}"
}

require_neon() {
  { [ -n "${NEON_API_KEY:-}" ] && [ -n "${NEON_PROJECT_ID:-}" ]; } || fail \
    "NEON_API_KEY and NEON_PROJECT_ID must be set in .env (this runner isolates each run on its own Neon branch). See docs/PARALLEL_WORKFLOW.md § Neon Database Branching."
}

# State shared with the EXIT trap. SERVER_PID is the `serve` dev server.
POOLED=""; UNPOOLED=""; BRANCH=""; KEEP=0; SERVER_PID=""
# Appended to the branch-cap error, so `serve` can name its way around the cap.
CAP_HINT=""

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

# Signal a process and all of its descendants, children first. `pnpm exec next
# dev` is a chain (pnpm → next → the dev-server worker); signalling only the top
# pid can orphan the worker still holding the port.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill -TERM "$pid" 2>/dev/null || true
}

on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if [ -n "$SERVER_PID" ]; then
    kill_tree "$SERVER_PID"
    wait "$SERVER_PID" 2>/dev/null || true
  fi
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
        || { log "$out"; fail "Neon branch create failed after GC (cap still exceeded?).${CAP_HINT}"; }
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

# The environment both `run` and `serve` start the app in. $1 is the port the
# dev server listens on. Branch mode points every consumer at the ephemeral
# branch; `serve --db env` has no branch and keeps the DATABASE_URL (and
# NEXT_PUBLIC_APP_ENV, which cmd_serve checks) that .env loaded.
export_isolated_env() {
  local port="$1"
  if [ -n "$BRANCH" ]; then
    # The app runtime AND the seed script (prisma/seed.ts) read DATABASE_URL
    # (pooled); `prisma migrate` reads DATABASE_URL_UNPOOLED (see prisma.config.ts).
    # Both point at the same branch, so exporting both covers every consumer.
    export DATABASE_URL="$POOLED"
    export DATABASE_URL_UNPOOLED="$UNPOOLED"
    export NEXT_PUBLIC_APP_ENV="test"
  fi
  # Bypass the IP rate limiter AND enable /api/e2e-seed (the invite-code minter
  # sign-up needs). Permitted because NEXT_PUBLIC_APP_ENV is a SAFE_ENV.
  export E2E_DISABLE_RATE_LIMIT="1"
  # Better Auth derives baseURL + trustedOrigins from NEXT_PUBLIC_APP_URL
  # (fallback localhost:3000). Pin it to the test port so CSRF origin checks
  # don't reject sign-up on :$port. See src/lib/env.ts getServerBaseURL().
  export NEXT_PUBLIC_APP_URL="http://localhost:$port"
  # Both sides of the purge-cron bearer check live in this process tree, so a
  # fixed literal is fine — the account-deletion spec (HON-479) calls the real
  # /api/cron/purge-deleted-users with it rather than the route growing a
  # test-only branch. Mirrors the value in .github/workflows/ci.yml. 32+ chars
  # to satisfy the env schema.
  export CRON_SECRET="${CRON_SECRET:-local-e2e-cron-secret-not-a-real-credential}"
}

run_seed() {
  # Seed the smoke fixtures only when their credentials are present (they live
  # in CI secrets, not local .env). The base meal/translation seed always runs.
  if [ -n "${SMOKE_TEST_EMAIL:-}" ]; then export SEED_TEST_USERS="1"; fi

  info "Seeding the ephemeral branch…"
  pnpm db:seed
}

# HTTP status from the local server, or 000 when nothing answers. `--max-time`
# is generous because the first request to a dev-server route compiles it.
http_status() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$1" 2>/dev/null || true
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

  export_isolated_env "$PORT"
  # Log per-step sign-up timings (hibp / scrypt / invite-code / total) so the
  # latency that intermittently blows the 30s budget is measurable (HON-569).
  export SIGNUP_TIMING_LOG="1"
  # Tells playwright.config.ts to start its own dev server on this port (never
  # reusing a stale :3000 server that would point at your real DB).
  export E2E_LOCAL_PORT="$PORT"

  info "Applying migrations to the ephemeral branch…"
  pnpm prisma migrate deploy

  run_seed

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

# Seconds `serve` waits for the dev server to answer before giving up.
REVIEW_READY_TIMEOUT_SECS=180

cmd_serve() {
  load_env; resolve_config

  local db_mode="branch" seed=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --seed)   seed=1 ;;
      --db)     [ $# -ge 2 ] || fail "--db needs a value: branch or env"; db_mode="$2"; shift ;;
      --db=*)   db_mode="${1#--db=}" ;;
      *)        fail "serve: unknown argument '$1' (see: bash scripts/e2e-local.sh --help)" ;;
    esac
    shift
  done
  case "$db_mode" in
    branch|env) ;;
    *) fail "--db must be 'branch' or 'env', got '$db_mode'" ;;
  esac
  # Seeding and migrating a shared database is the person's call, not this
  # script's — the same reason env mode only checks migration status.
  [ "$db_mode" = "env" ] && [ "$seed" = "1" ] && fail "--seed only applies to branch mode; seed the .env database yourself with: pnpm db:seed"

  local url="http://localhost:$REVIEW_PORT"
  # Checked before a branch is created, so a doomed run never spends one.
  [ "$(http_status "$url/")" = "000" ] \
    || fail "something is already listening on $url. Stop it, or pick another port with REVIEW_LOCAL_PORT=<port>."

  trap on_exit EXIT INT TERM

  if [ "$db_mode" = "branch" ]; then
    require_neon
    CAP_HINT=" No branch slot is free — review against the database in .env instead: pnpm review:local --db env"
    create_branch
    export_isolated_env "$REVIEW_PORT"

    info "Applying migrations to the ephemeral branch…"
    pnpm prisma migrate deploy
    if [ "$seed" = "1" ]; then run_seed; fi
  else
    [ -n "${DATABASE_URL:-}" ] || fail "--db env needs DATABASE_URL in .env."
    case "${NEXT_PUBLIC_APP_ENV:-}" in
      ci|test|dev) ;;
      # Any other value keeps /api/e2e-seed at 404 and the rate limiter on.
      *) export NEXT_PUBLIC_APP_ENV="dev" ;;
    esac
    export_isolated_env "$REVIEW_PORT"

    info "Checking migration status of the .env database (not applying anything)…"
    local status
    if ! status="$(pnpm prisma migrate status 2>&1)" || ! printf '%s\n' "$status" | grep -q "Database schema is up to date"; then
      log "$status"
      fail "the .env database is not up to date with prisma/migrations. Apply them yourself, then retry: pnpm db:migrate:deploy"
    fi
    warn "--db env: accounts you create are written to the database in .env and persist after this server stops. Clean them up: docs/CHROME_TESTING.md → \"Reviewing sign-up and onboarding\" → Cleanup."
  fi

  info "Starting the review server on ${url}…"
  # Backgrounded and waited on, not run in the foreground: bash defers a trap
  # until a foreground child exits, so `kill <this script>` would leave the
  # server running and the branch undeleted. `wait` is interrupted by the trap.
  pnpm exec next dev --port "$REVIEW_PORT" &
  SERVER_PID=$!

  local waited=0
  until [ "$(http_status "$url/sign-up")" != "000" ]; do
    kill -0 "$SERVER_PID" 2>/dev/null || fail "the dev server exited before it answered on $url."
    [ "$waited" -lt "$REVIEW_READY_TIMEOUT_SECS" ] || fail "the dev server did not answer on $url within ${REVIEW_READY_TIMEOUT_SECS}s."
    sleep 1; waited=$((waited + 1))
  done

  # The one line an agent that backgrounded this command waits on. stdout, so it
  # is not interleaved with the coloured progress on stderr.
  printf 'REVIEW-READY %s db=%s\n' "$url" "${BRANCH:-env}"

  local rc=0
  wait "$SERVER_PID" || rc=$?
  SERVER_PID=""
  return "$rc"
}

# Print the header comment block (everything between the shebang and the first
# non-comment line), stripped of the leading "# ".
usage() { awk 'NR==1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; }

main() {
  case "${1:-run}" in
    gc)               shift; cmd_gc "$@" ;;
    serve)            shift; cmd_serve "$@" ;;
    -h|--help|help)   usage ;;
    # `${1:-run}` also matches an empty argv, where a bare `shift` returns 1
    # and `set -e` aborts before anything runs — so only shift a real "run".
    run)              if [ $# -gt 0 ]; then shift; fi; cmd_run "$@" ;;
    *)                cmd_run "$@" ;;
  esac
}

main "$@"

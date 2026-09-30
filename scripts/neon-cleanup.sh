#!/usr/bin/env bash
# Garbage-collect stale `<prefix>--hon-<N>` Neon branches created by
# `/auto-implement` worktrees (`auto--hon-51`, `kaupokorv--hon-51-slug`, …),
# and orphaned `preview/<git-branch>` branches the Vercel–Neon integration
# re-creates after a PR is gone (HON-852).
# See docs/RUNBOOKS/neon-branch-gc.md for the full runbook.
#
# Subcommands:
#   sweep                              List all <prefix>--hon-<N> branches,
#                                      delete those whose linked Linear issue is
#                                      Done or Canceled and that are > 24h old.
#                                      Also list all preview/<ref> branches and
#                                      delete those > 24h old whose <ref> is gone
#                                      from origin and heads no open PR.
#   delete-for-branch <git-branch>     Delete the Neon branch paired with a
#                                      merged PR's head ref (`/` -> `--`), or,
#                                      when the branch carries no HON id, the
#                                      `auto--hon-<N>` named by PR_BODY's
#                                      `Closes HON-N`.
#                                      Does NOT gate on Linear status — the
#                                      explicit merge signal is authoritative.
#
# Required env:
#   NEON_API_KEY, NEON_PROJECT_ID, LINEAR_API_KEY
#   (sweep, preview path) `git` with a reachable remote and `gh` authenticated
#   for this repo — GH_TOKEN in the workflow.
#
# Optional env:
#   NEON_CLEANUP_DRY_RUN        "1" to log without DELETE (default). "0" to delete.
#   NEON_CLEANUP_MIN_AGE_HOURS  Sweep age gate in hours (default 24). Set to 0
#                               for the one-time cleanup to bypass the gate.
#   PR_BODY                     Piped PR body, used by `delete-for-branch` as
#                               the fallback for HON-ID extraction.
#   NEON_CLEANUP_GIT_REMOTE     Remote the preview path checks refs on
#                               (default origin).
#
# Safety invariants (MUST all hold for a branch to be deleted):
#   - Name matches SAFE_BRANCH_REGEX (<prefix>--hon-<N>[-slug])
#   - primary != true and protected != true (per the Neon branch record)
#   - Name is not in the hardcoded allowlist {main, staging, dev/kaupo, vercel-dev}
#   - (sweep only) updated_at is older than NEON_CLEANUP_MIN_AGE_HOURS
#   - (sweep only) linked Linear issue is Done or Canceled — Linear lookup
#     failure defaults to DO NOT DELETE
#
# The preview/* path has its own gate (preview_skip_reason), and ALL of these
# must hold instead:
#   - Name is `preview/<ref>` and <ref> matches PREVIEW_REF_REGEX, has no `..`
#     or `//`, and does not start with `-` or `/` or end with `/`
#   - default != true and protected != true, and not in ALLOWLIST_NAMES
#   - updated_at is older than NEON_CLEANUP_MIN_AGE_HOURS
#   - refs/heads/<ref> does not exist on the remote (`git ls-remote` exit 2);
#     any other lookup failure defaults to DO NOT DELETE
#   - no open PR has <ref> as its head; `gh` failure defaults to DO NOT DELETE
set -euo pipefail

NEON_API_BASE="https://console.neon.tech/api/v2"
LINEAR_API_URL="https://api.linear.app/graphql"
# Neon branch names this script is allowed to delete: `<prefix>--hon-<N>` with an
# optional slug tail. `--` is worktree-claude.sh's neon_branch_name mapping of the
# git `/`, so this covers the orchestrator's fallback `auto/hon-51` -> `auto--hon-51`
# AND the Linear branch names spawn_worker actually uses,
# `kaupokorv/hon-51-slug` -> `kaupokorv--hon-51-slug`. Before HON-572 the pattern
# was `^auto--hon-[0-9]+$`, which matched only the fallback — so no reaper on any
# path recognised a real orchestrator branch and they leaked until the branch cap.
# Widening the NAME filter is safe because it is not the safety gate: default/
# protected flags, ALLOWLIST_NAMES, the Linear Done/Canceled check and the age
# gate all still have to pass. Capture group 1 is the HON number.
# Kept in sync with NEON_ISSUE_BRANCH_REGEX in scripts/worktree-claude.sh.
SAFE_BRANCH_REGEX='^[A-Za-z0-9._-]+--hon-([0-9]+)(-[A-Za-z0-9._-]+)?$'
ALLOWLIST_NAMES=(main staging dev/kaupo vercel-dev)
# The Vercel–Neon integration names its branch `preview/<git-branch>`. The ref
# charset is deliberately narrower than git's: anything outside it is left for a
# human rather than passed to `git ls-remote` / `gh`. Kept in sync with
# PREVIEW_REF_REGEX in scripts/worktree-claude.sh.
PREVIEW_PREFIX='preview/'
PREVIEW_REF_REGEX='^[A-Za-z0-9._/-]+$'
GIT_REMOTE="${NEON_CLEANUP_GIT_REMOTE:-origin}"
DRY_RUN="${NEON_CLEANUP_DRY_RUN:-1}"
MIN_AGE_HOURS="${NEON_CLEANUP_MIN_AGE_HOURS:-24}"

# ─── Logging ─────────────────────────────────────────────────────────────────

log()  { printf '%s\n' "$*" >&2; }
warn() { printf 'warn: %s\n' "$*" >&2; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

# ─── Env validation ──────────────────────────────────────────────────────────

require_env() {
  local missing=()
  [ -z "${NEON_API_KEY:-}" ]     && missing+=("NEON_API_KEY")
  [ -z "${NEON_PROJECT_ID:-}" ]  && missing+=("NEON_PROJECT_ID")
  [ -z "${LINEAR_API_KEY:-}" ]   && missing+=("LINEAR_API_KEY")
  if [ "${#missing[@]}" -gt 0 ]; then
    fail "missing required env: ${missing[*]}"
  fi
}

# ─── HTTP helpers ────────────────────────────────────────────────────────────

neon_api() {
  local method="$1" path="$2" body="${3:-}"
  local url="${NEON_API_BASE}${path}"
  local curl_args=(-sS --max-time 30 -w '\n%{http_code}'
    -H "Authorization: Bearer $NEON_API_KEY"
    -H "Accept: application/json"
    -X "$method" "$url")
  if [ -n "$body" ]; then
    curl_args+=(-H "Content-Type: application/json" -d "$body")
  fi

  local response status
  response=$(curl "${curl_args[@]}") || {
    warn "neon_api: curl failed for $method $path"
    return 1
  }
  status="${response##*$'\n'}"
  response="${response%$'\n'*}"

  if [ "$status" -ge 400 ]; then
    warn "neon_api: $method $path → HTTP $status: $response"
    return 1
  fi
  printf '%s' "$response"
}

linear_api() {
  local query="$1"
  local payload
  payload=$(jq -cn --arg q "$query" '{query: $q}')

  local response status
  response=$(curl -sS --max-time 30 -w '\n%{http_code}' \
    -H "Content-Type: application/json" \
    -H "Authorization: $LINEAR_API_KEY" \
    -d "$payload" \
    -X POST "$LINEAR_API_URL") || {
    warn "linear_api: curl failed"
    return 1
  }
  status="${response##*$'\n'}"
  response="${response%$'\n'*}"

  if [ "$status" -ge 400 ]; then
    warn "linear_api: HTTP $status: $response"
    return 1
  fi
  if printf '%s' "$response" | jq -e '.errors[0]' > /dev/null 2>&1; then
    local msg
    msg=$(printf '%s' "$response" | jq -r '.errors[0].message // "unknown"')
    warn "linear_api: GraphQL error: $msg"
    return 1
  fi
  printf '%s' "$response"
}

# ─── Safety checks ───────────────────────────────────────────────────────────

# Reads one branch JSON object on stdin, returns 0 if it is safe to delete.
# Usage: printf '%s' "$branch_json" | is_safe_to_delete <mode>
# Modes: "sweep" (enforces > 24h age) or "merge" (skips age gate).
is_safe_to_delete() {
  local mode="$1" branch_json
  branch_json=$(cat)

  local name is_default is_protected
  name=$(printf '%s' "$branch_json" | jq -r '.name // ""')
  # Neon's `primary` field is deprecated in favour of `default` — read `default`
  # with `primary` as the fallback so we're correct before and after Neon drops
  # the deprecated field from the API.
  is_default=$(printf '%s' "$branch_json" | jq -r '.default // .primary // false')
  is_protected=$(printf '%s' "$branch_json" | jq -r '.protected // false')

  if ! [[ "$name" =~ $SAFE_BRANCH_REGEX ]]; then
    return 1
  fi
  if [ "$is_default" = "true" ] || [ "$is_protected" = "true" ]; then
    warn "skip $name: default=$is_default protected=$is_protected"
    return 1
  fi
  local allowed
  for allowed in "${ALLOWLIST_NAMES[@]}"; do
    if [ "$name" = "$allowed" ]; then
      warn "skip $name: allowlisted protected branch name"
      return 1
    fi
  done

  if [ "$mode" = "sweep" ]; then
    printf '%s' "$branch_json" | older_than_min_age || return 1
  fi
  return 0
}

# Reads one branch JSON object on stdin, returns 0 if its updated_at is older
# than MIN_AGE_HOURS (always 0 when the gate is off). Shared by both sweep paths.
older_than_min_age() {
  local branch_json name
  branch_json=$(cat)
  [ "$MIN_AGE_HOURS" -gt 0 ] || return 0
  name=$(printf '%s' "$branch_json" | jq -r '.name // ""')

  local updated_at age_sec now min_age_sec
  updated_at=$(printf '%s' "$branch_json" | jq -r '.updated_at // ""')
  if [ -z "$updated_at" ]; then
    warn "skip $name: missing updated_at"
    return 1
  fi
  now=$(date -u +%s)
  age_sec=$(( now - $(parse_iso8601 "$updated_at") ))
  min_age_sec=$(( MIN_AGE_HOURS * 3600 ))
  if [ "$age_sec" -lt "$min_age_sec" ]; then
    warn "skip $name: younger than ${MIN_AGE_HOURS}h (age ${age_sec}s)"
    return 1
  fi
  return 0
}

# Portable ISO-8601 → unix timestamp. Handles "2026-04-19T09:12:30.938Z" on
# both BSD date (macOS) and GNU date (Linux runners).
parse_iso8601() {
  local ts="$1"
  ts="${ts%.*Z}"; ts="${ts%Z}"
  if date -u -d "$ts" +%s >/dev/null 2>&1; then
    date -u -d "$ts" +%s
  else
    date -u -j -f '%Y-%m-%dT%H:%M:%S' "$ts" +%s
  fi
}

# Returns 0 only if the Linear issue's state type is `completed` or `canceled`.
# Fail-safe: any lookup error returns non-zero so the caller does not delete.
issue_done_or_canceled() {
  local hon_id="$1"
  local query response state_type
  query=$(printf 'query { issue(id: "%s") { state { type } } }' "$hon_id")
  response=$(linear_api "$query") || return 1
  state_type=$(printf '%s' "$response" | jq -r '.data.issue.state.type // ""')
  case "$state_type" in
    completed|canceled) return 0 ;;
    *) return 1 ;;
  esac
}

# ─── preview/* ownership checks (HON-852) ────────────────────────────────────

# 0 if <ref> is a plausible git branch name this script may pass to git/gh.
# A leading `-` would be read as an option; `..` and `//` are not valid refs.
preview_ref_plausible() {
  local ref="$1"
  [ -n "$ref" ] || return 1
  [[ "$ref" =~ $PREVIEW_REF_REGEX ]] || return 1
  case "$ref" in
    -*|/*|*/|*..*|*//*) return 1 ;;
  esac
  return 0
}

# Prints `present`, `absent` or `error`. Asks for the full refs/heads/ path so
# ls-remote's tail matching cannot report `x/hon-1` for `hon-1`. `--exit-code`
# makes "no such ref" exit 2, which is the ONLY answer read as absent — auth,
# network or a missing remote exit otherwise and must never read as an orphan.
preview_ref_state() {
  local ref="$1" rc=0
  git ls-remote --exit-code --heads "$GIT_REMOTE" "refs/heads/$ref" >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0) echo present ;;
    2) echo absent ;;
    *) echo error ;;
  esac
}

# Prints the number of open PRs whose head is <ref>, or nothing on failure.
preview_open_pr_count() {
  local ref="$1" prs
  prs=$(gh pr list --state open --head "$ref" --json number --limit 100 2>/dev/null) || return 1
  printf '%s' "$prs" | jq -e 'if type == "array" then length else error("not an array") end' 2>/dev/null
}

# Reads one preview/* branch JSON object on stdin. Prints `ok` when the branch
# is an orphan that may be deleted, or a one-word skip reason otherwise. The
# verdict is positive on purpose: a helper that dies partway (a jq or date
# failure under `set -e`) prints nothing, and nothing must never mean delete.
# Separate from is_safe_to_delete on purpose: SAFE_BRANCH_REGEX excludes `/`,
# and the ownership signal here is git + GitHub, not Linear. Cheap checks run
# before the network ones.
preview_skip_reason() {
  local branch_json name ref is_default is_protected
  branch_json=$(cat)
  name=$(printf '%s' "$branch_json" | jq -r '.name // ""')
  ref="${name#"$PREVIEW_PREFIX"}"

  if [ "$ref" = "$name" ] || ! preview_ref_plausible "$ref"; then
    echo invalid-ref; return 0
  fi
  is_default=$(printf '%s' "$branch_json" | jq -r '.default // .primary // false')
  is_protected=$(printf '%s' "$branch_json" | jq -r '.protected // false')
  if [ "$is_default" = "true" ] || [ "$is_protected" = "true" ]; then
    echo protected; return 0
  fi
  local allowed
  for allowed in "${ALLOWLIST_NAMES[@]}"; do
    if [ "$name" = "$allowed" ]; then
      echo allowlisted; return 0
    fi
  done
  if ! printf '%s' "$branch_json" | older_than_min_age; then
    echo too-young; return 0
  fi

  case "$(preview_ref_state "$ref")" in
    absent) ;;
    present) echo ref-on-remote; return 0 ;;
    *) echo ref-lookup-failed; return 0 ;;
  esac

  local open_prs
  if ! open_prs=$(preview_open_pr_count "$ref"); then
    echo pr-lookup-failed; return 0
  fi
  if [ "$open_prs" != "0" ]; then
    echo open-pr; return 0
  fi
  echo ok
}

# ─── Deletion ────────────────────────────────────────────────────────────────

delete_branch() {
  local branch_id="$1" name="$2"
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN would delete: $name ($branch_id)"
    return 0
  fi
  if neon_api DELETE "/projects/${NEON_PROJECT_ID}/branches/${branch_id}" >/dev/null; then
    log "DELETED: $name ($branch_id)"
    return 0
  fi
  warn "failed to delete $name ($branch_id)"
  return 1
}

# ─── Sweep ───────────────────────────────────────────────────────────────────

cmd_sweep() {
  require_env
  log "sweep: listing branches for project $NEON_PROJECT_ID (dry_run=$DRY_RUN)"
  local response branches_json
  response=$(neon_api GET "/projects/${NEON_PROJECT_ID}/branches") \
    || fail "cannot list branches"
  branches_json=$(printf '%s' "$response" | jq -c '.branches[]')

  local considered=0 deleted=0 skipped_safe=0 skipped_status=0
  # preview/* path (HON-852). Reasons are newline-accumulated rather than kept
  # in an associative array: macOS ships bash 3.2, and the tests run there.
  local preview_considered=0 preview_candidates=0 preview_deleted=0
  local preview_with_usage=0 preview_skip_reasons=""
  while IFS= read -r branch; do
    [ -n "$branch" ] || continue
    local name hon_num
    name=$(printf '%s' "$branch" | jq -r '.name')

    if [[ "$name" == "$PREVIEW_PREFIX"* ]]; then
      preview_considered=$((preview_considered + 1))
      local reason
      reason=$(printf '%s' "$branch" | preview_skip_reason) || true
      [ -n "$reason" ] || reason=gate-error
      if [ "$reason" != "ok" ]; then
        log "skip $name: preview $reason"
        preview_skip_reasons+="${reason}"$'\n'
        continue
      fi
      preview_candidates=$((preview_candidates + 1))
      # A branch with usage but no git ref is still an orphan (the ref and PR
      # checks are the ownership signal); say so, so it shows in the summary.
      local compute written usage=""
      compute=$(printf '%s' "$branch" | jq -r '.compute_time_seconds // 0')
      written=$(printf '%s' "$branch" | jq -r '.written_data_bytes // 0')
      if [ "$compute" != "0" ] || [ "$written" != "0" ]; then
        usage=" (usage: compute_time_seconds=$compute written_data_bytes=$written)"
        preview_with_usage=$((preview_with_usage + 1))
      fi
      log "preview candidate: $name$usage"
      local preview_id
      preview_id=$(printf '%s' "$branch" | jq -r '.id')
      if delete_branch "$preview_id" "$name"; then
        preview_deleted=$((preview_deleted + 1))
      fi
      continue
    fi

    [[ "$name" =~ $SAFE_BRANCH_REGEX ]] || continue
    # Capture the number NOW: is_safe_to_delete runs in a pipeline subshell, but
    # any later [[ =~ ]] in this shell would clobber BASH_REMATCH.
    hon_num="${BASH_REMATCH[1]}"
    considered=$((considered + 1))

    if ! printf '%s' "$branch" | is_safe_to_delete sweep; then
      skipped_safe=$((skipped_safe + 1))
      continue
    fi

    local hon_id
    hon_id="HON-${hon_num}"
    if ! issue_done_or_canceled "$hon_id"; then
      log "skip $name: $hon_id not Done/Canceled (or Linear lookup failed)"
      skipped_status=$((skipped_status + 1))
      continue
    fi

    local branch_id
    branch_id=$(printf '%s' "$branch" | jq -r '.id')
    if delete_branch "$branch_id" "$name"; then
      deleted=$((deleted + 1))
    fi
  done <<< "$branches_json"

  local verb_lower verb_title
  if [ "$DRY_RUN" = "1" ]; then
    verb_lower="would delete"
    verb_title="Would delete"
  else
    verb_lower="deleted"
    verb_title="Deleted"
  fi
  # `reason=count` pairs, sorted by reason, e.g. `open-pr=1 ref-on-remote=2`.
  local preview_skipped
  preview_skipped=$(printf '%s' "$preview_skip_reasons" | grep -v '^$' | sort | uniq -c \
    | awk '{printf "%s%s=%s", (NR > 1 ? " " : ""), $2, $1}' || true)
  local summary
  summary=$(printf 'neon-cleanup sweep: considered=%d %s=%d skipped_safety=%d skipped_status=%d dry_run=%s' \
    "$considered" "$verb_lower" "$deleted" "$skipped_safe" "$skipped_status" "$DRY_RUN")
  log "$summary"
  log "$(printf 'neon-cleanup sweep: preview considered=%d candidates=%d %s=%d with_usage=%d skipped: %s' \
    "$preview_considered" "$preview_candidates" "$verb_lower" "$preview_deleted" \
    "$preview_with_usage" "${preview_skipped:-none}")"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "## Neon cleanup sweep"
      echo
      echo "- Considered: $considered"
      echo "- $verb_title: $deleted"
      echo "- Skipped (safety): $skipped_safe"
      echo "- Skipped (status): $skipped_status"
      echo "- Preview considered: $preview_considered"
      echo "- Preview candidates: $preview_candidates"
      echo "- Preview $verb_lower: $preview_deleted"
      echo "- Preview with usage: $preview_with_usage"
      echo "- Preview skipped: ${preview_skipped:-none}"
      echo "- Dry run: $DRY_RUN"
    } >> "$GITHUB_STEP_SUMMARY"
  fi
}

# ─── delete-for-branch (post-merge) ──────────────────────────────────────────

# Map a merged PR's git branch to the Neon branch name to reap, or print nothing
# when there is none. Pure — no network, no env. Extracted so it is unit-testable
# from scripts/orchestrator.test.ts.
#
# The `/` -> `--` mapping mirrors worktree-claude.sh's neon_branch_name, so
# `kaupokorv/hon-51-slug` resolves to the Neon branch that actually exists,
# `kaupokorv--hon-51-slug`. Before HON-572 this matched `^auto--hon-([0-9]+)$`
# against the raw GIT branch — a shape the head ref never has — so the on-merge
# reaper only ever fired through the PR_BODY fallback, and even then guessed the
# name `auto--hon-<N>`, which an orchestrator run does not create.
neon_branch_target_for_git_branch() {
  local git_branch="${1:-}"
  local mapped="${git_branch//\//--}"

  if [[ "$mapped" =~ $SAFE_BRANCH_REGEX ]]; then
    printf '%s\n' "$mapped"
    return 0
  fi

  # Fallback: no HON id in the branch name (hand-named branch, posthog/<slug>,
  # …). Read `Closes HON-N` out of the PR body and reap the conventional
  # `auto--hon-<N>` name, which is all we can infer without the branch.
  if [ -n "${PR_BODY:-}" ]; then
    local hon_num
    # GitHub recognises close/fix/resolve (+ closed/fixes/resolved/…) in any case.
    # Left-anchor on start-of-line or whitespace so "Discloses HON-N" doesn't
    # match "closes HON-N" mid-word and wrongly reap an in-flight branch.
    hon_num=$(printf '%s' "$PR_BODY" \
      | grep -oiE '(^|[[:space:]])(close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]]+HON-[0-9]+' \
      | head -n1 \
      | grep -oE '[0-9]+$' || true)
    if [ -n "$hon_num" ]; then
      printf '%s\n' "auto--hon-${hon_num}"
      return 0
    fi
  fi

  return 0
}

cmd_delete_for_branch() {
  local git_branch="${1:-}"
  [ -n "$git_branch" ] || fail "usage: delete-for-branch <git-branch>"

  local target_name
  target_name=$(neon_branch_target_for_git_branch "$git_branch")

  if [ -z "$target_name" ]; then
    log "no HON-linked Neon branch to reap for '$git_branch' — nothing to do"
    return 0
  fi

  # Only assert env once we know there is actual work to do, and keep the
  # merge path independent of LINEAR_API_KEY (which it doesn't use).
  local missing=()
  [ -z "${NEON_API_KEY:-}" ]    && missing+=("NEON_API_KEY")
  [ -z "${NEON_PROJECT_ID:-}" ] && missing+=("NEON_PROJECT_ID")
  if [ "${#missing[@]}" -gt 0 ]; then
    fail "missing required env: ${missing[*]}"
  fi

  log "delete-for-branch: looking up $target_name (dry_run=$DRY_RUN)"

  local response branch
  response=$(neon_api GET "/projects/${NEON_PROJECT_ID}/branches") \
    || fail "cannot list branches"
  branch=$(printf '%s' "$response" | jq -c --arg n "$target_name" '.branches[] | select(.name == $n)')

  if [ -z "$branch" ]; then
    log "no Neon branch named $target_name — already cleaned up"
    return 0
  fi

  if ! printf '%s' "$branch" | is_safe_to_delete merge; then
    warn "refusing to delete $target_name: failed safety check"
    return 0
  fi

  local branch_id
  branch_id=$(printf '%s' "$branch" | jq -r '.id')
  delete_branch "$branch_id" "$target_name"
}

# ─── Dispatch ────────────────────────────────────────────────────────────────

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    sweep)             cmd_sweep "$@" ;;
    delete-for-branch) cmd_delete_for_branch "$@" ;;
    "" | help | -h | --help)
      cat <<EOF
Usage: $(basename "$0") <command> [args]

Commands:
  sweep                          GC stale <prefix>--hon-<N> branches (respects
                                 Linear status and 24h age gate), and
                                 preview/<ref> branches whose <ref> is gone from
                                 origin and heads no open PR.
  delete-for-branch <git-branch> Delete the Neon branch paired with a
                                 just-merged PR's head ref (reads PR_BODY for
                                 the \`Closes HON-N\` fallback).

Env: NEON_API_KEY, NEON_PROJECT_ID, LINEAR_API_KEY required.
     NEON_CLEANUP_DRY_RUN=1 (default) to simulate, 0 to delete.
EOF
      ;;
    *) fail "unknown command: $cmd (try --help)" ;;
  esac
}

# Only dispatch when EXECUTED. The workflow and the runbook both invoke this as
# `./scripts/neon-cleanup.sh <cmd>`, so this is behaviour-neutral; it exists so
# scripts/orchestrator.test.ts can source the file and unit-test the pure
# helpers (SAFE_BRANCH_REGEX, neon_branch_target_for_git_branch) without an
# `unknown command` fail and without touching the Neon or Linear APIs.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi

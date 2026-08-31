#!/bin/bash
# Autonomous Issue Orchestrator
#
# Polls Linear for Todo issues, claims them atomically, spawns worktree workers,
# and handles the full lifecycle including failure triage.
#
# Usage:
#   ./scripts/orchestrator.sh                          # Run with defaults
#   ./scripts/orchestrator.sh --max-workers 3          # Limit concurrent workers
#   ./scripts/orchestrator.sh --dry-run                # Log actions without executing
#   ./scripts/orchestrator.sh --once                   # Single poll cycle, then exit
#   ./scripts/orchestrator.sh --poll-interval 30       # Poll every 30 seconds
#   ./scripts/orchestrator.sh --worker-timeout 7200    # 2 hour worker timeout
#
# Required:
#   LINEAR_API_KEY env var (format: lin_api_...)
#
# See docs/PARALLEL_WORKFLOW.md for full documentation.

set -euo pipefail

# ─── Constants ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
REPO_NAME="wobblepot"
WORKTREE_BASE="$HOME/.worktrees/$REPO_NAME"
LOG_DIR="$WORKTREE_BASE/logs"
STATUS_FILE="$WORKTREE_BASE/orchestrator-status.json"
PID_FILE="$WORKTREE_BASE/orchestrator.pid"
LINEAR_API_URL="https://api.linear.app/graphql"

# Linear workflow state IDs (Honkadori workspace)
STATE_BACKLOG="035a5cef-88de-4334-98a0-b908f61d26a7"
STATE_TODO="bcd0f639-33dd-4da8-a081-4d409c0fe5b4"
STATE_IN_PROGRESS="efa0cbda-898d-440d-a6a9-36e798d00881"
STATE_DONE="5b47cab2-e519-4532-8aa2-f4926e16bcd7"
STATE_CANCELED="20dedb1c-9cb4-4db4-8a3a-c2eb39fbd616"
STATE_DUPLICATE="d173c772-7085-46c9-bece-6a8a74d0ae27"  # never clears a blocker — select_next_issue flags it in its [SKIP] log line

# ─── Worker tracking (parallel arrays, bash 3.2 compatible) ──────────────────

WORKER_PIDS=()
WORKER_ISSUES=()
WORKER_ISSUE_UUIDS=()
WORKER_BRANCHES=()
WORKER_LOGS=()
WORKER_START_TIMES=()
WORKER_RETRIED=()
WORKER_TITLES=()

# ─── Configuration ───────────────────────────────────────────────────────────

MAX_WORKERS="${ORCHESTRATOR_MAX_WORKERS:-5}"
POLL_INTERVAL="${ORCHESTRATOR_POLL_INTERVAL:-60}"
WORKER_TIMEOUT="${ORCHESTRATOR_WORKER_TIMEOUT:-3600}"
DRY_RUN=false
RUN_ONCE=false

# ─── State ───────────────────────────────────────────────────────────────────

SHUTTING_DOWN=false
FORCE_SHUTDOWN=false
ONCE_SPAWNED=false
ONCE_EXIT_CODE=2  # Default: no issues found
TEAM_UUID=""
CONSECUTIVE_FAILURES=0
MAX_CONSECUTIVE_FAILURES=3
PAUSED_UNTIL=0
# File of "identifier<TAB>reason" keys already logged as [SKIP], one per line,
# so select_next_issue emits one line per issue+reason instead of repeating it
# every poll. A file rather than a variable because main() calls
# select_next_issue inside $(...): a variable appended there dies with the
# subshell and every poll would log again. Removed by the EXIT trap.
# Explicit XXXXXXXX template rather than `mktemp -t orchestrator-skips`:
# BSD/macOS mktemp appends the random suffix to a -t prefix, but GNU
# coreutils requires the template to end in at least three X's and fails
# outright otherwise — which made this line abort the script on Linux.
SEEN_SKIPS_FILE=$(mktemp "${TMPDIR:-/tmp}/orchestrator-skips.XXXXXXXX")
# main() re-installs a fuller EXIT trap; this one covers the early exits in
# argument parsing and acquire_lock so the temp file never leaks.
trap 'rm -f "$SEEN_SKIPS_FILE"' EXIT
# Comma-separated identifiers of issues gated this run (worker exited 0 with
# no commits). They go back to Todo unassigned, so without this list the
# picker would re-select them on the very next poll and respawn the same
# no-op worker in a loop whenever the durable Gated-label write failed. An
# entry is dropped as soon as selection sees the issue without its Gated
# label (operator removed it — the retry signal); a restart also clears it.
GATED_ISSUES=""

# ─── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

# ─── Argument parsing ────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case $1 in
    --max-workers)    MAX_WORKERS="$2"; shift 2 ;;
    --poll-interval)  POLL_INTERVAL="$2"; shift 2 ;;
    --worker-timeout) WORKER_TIMEOUT="$2"; shift 2 ;;
    --dry-run)        DRY_RUN=true; shift ;;
    --once)           RUN_ONCE=true; shift ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --max-workers N      Max concurrent workers (default: 5)"
      echo "  --poll-interval N    Seconds between polls (default: 60)"
      echo "  --worker-timeout N   Seconds before killing a worker (default: 3600)"
      echo "  --dry-run            Log actions without executing"
      echo "  --once               Single poll cycle, then exit"
      echo ""
      echo "Environment variables:"
      echo "  LINEAR_API_KEY              Required (format: lin_api_...)"
      echo "  ORCHESTRATOR_MAX_WORKERS    Override --max-workers default"
      echo "  ORCHESTRATOR_POLL_INTERVAL  Override --poll-interval default"
      echo "  ORCHESTRATOR_WORKER_TIMEOUT Override --worker-timeout default"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ─── Instance lock ──────────────────────────────────────────────────────────

acquire_lock() {
  mkdir -p "$(dirname "$PID_FILE")"

  if [ -f "$PID_FILE" ]; then
    local existing_pid
    existing_pid=$(cat "$PID_FILE" 2>/dev/null) || true

    if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
      echo "Error: Another orchestrator is already running (PID $existing_pid)" >&2
      echo "PID file: $PID_FILE" >&2
      exit 1
    else
      echo "Warning: Stale PID file found (PID $existing_pid is dead), overwriting" >&2
    fi
  fi

  echo "$$" > "$PID_FILE"
}

release_lock() {
  rm -f "$PID_FILE"
}

# ─── Logging ─────────────────────────────────────────────────────────────────

mkdir -p "$LOG_DIR"
MAIN_LOG="$LOG_DIR/orchestrator.log"

log() {
  local level="$1"; shift
  local ts
  ts=$(date '+%Y-%m-%d %H:%M:%S')
  local color=""
  case "$level" in
    INFO)  color="$GREEN" ;;
    WARN)  color="$YELLOW" ;;
    ERROR) color="$RED" ;;
    DEBUG) color="$DIM" ;;
  esac
  # Two destinations, deliberately: a colored line on stderr for whoever is
  # watching, and a clean line in $MAIN_LOG. `log` is the ONLY writer of
  # $MAIN_LOG — cmd_start must not fold stderr back into the same file, or
  # every line is stored twice and one copy carries raw ANSI escapes (HON-572).
  printf "${DIM}%s${NC} ${color}%-5s${NC} %s\n" "$ts" "$level" "$*" >&2
  printf "%s %-5s %s\n" "$ts" "$level" "$*" >> "$MAIN_LOG"
}

# ─── Status file ─────────────────────────────────────────────────────────────
# Machine-readable JSON status for `wt status` to consume.
# Written atomically (temp + mv) to avoid partial reads.

ORCHESTRATOR_START_TIME=""

write_status_file() {
  local workers_json="[]"

  if [ ${#WORKER_PIDS[@]} -gt 0 ]; then
    workers_json="["
    local i=0
    while [ $i -lt ${#WORKER_PIDS[@]} ]; do
      [ $i -gt 0 ] && workers_json+=","
      workers_json+=$(jq -n \
        --arg issue "${WORKER_ISSUES[$i]}" \
        --arg title "${WORKER_TITLES[$i]}" \
        --argjson pid "${WORKER_PIDS[$i]}" \
        --arg branch "${WORKER_BRANCHES[$i]}" \
        --arg started_at "$(date -r "${WORKER_START_TIMES[$i]}" -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        --arg log_file "${WORKER_LOGS[$i]}" \
        --argjson retried "$([ "${WORKER_RETRIED[$i]}" = "1" ] && echo true || echo false)" \
        '{issue: $issue, title: $title, pid: $pid, branch: $branch, started_at: $started_at, log_file: $log_file, retried: $retried}')
      i=$((i + 1))
    done
    workers_json+="]"
  fi

  local paused_until_val="null"
  [ "$PAUSED_UNTIL" -gt 0 ] && paused_until_val="$(date -r "$PAUSED_UNTIL" -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo null)"

  local tmp_file="${STATUS_FILE}.tmp.$$"
  jq -n \
    --argjson pid "$$" \
    --arg started_at "$ORCHESTRATOR_START_TIME" \
    --arg last_poll "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    --argjson max_workers "$MAX_WORKERS" \
    --argjson circuit_breaker "$(jq -n \
      --argjson consecutive_failures "$CONSECUTIVE_FAILURES" \
      --arg paused_until "${paused_until_val}" \
      'if $paused_until == "null" then {consecutive_failures: $consecutive_failures, paused_until: null}
       else {consecutive_failures: $consecutive_failures, paused_until: $paused_until} end')" \
    --argjson workers "$workers_json" \
    '{pid: $pid, started_at: $started_at, last_poll: $last_poll, max_workers: $max_workers, circuit_breaker: $circuit_breaker, workers: $workers}' \
    > "$tmp_file" 2>/dev/null && mv "$tmp_file" "$STATUS_FILE" || rm -f "$tmp_file"
}

cleanup_status_file() {
  rm -f "$STATUS_FILE"
}

# ─── Linear API ──────────────────────────────────────────────────────────────

linear_api() {
  local query="$1"
  local variables="${2:-null}"
  local payload
  payload=$(jq -n --arg q "$query" --argjson v "$variables" '{query: $q, variables: $v}')

  local response
  response=$(curl -s --max-time 30 -X POST "$LINEAR_API_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: $LINEAR_API_KEY" \
    -d "$payload") || {
    log ERROR "Linear API request failed (curl error)"
    return 1
  }

  if echo "$response" | jq -e '.errors[0]' > /dev/null 2>&1; then
    local msg
    msg=$(echo "$response" | jq -r '.errors[0].message // "Unknown error"')
    log ERROR "Linear API error: $msg"
    return 1
  fi

  echo "$response"
}

# ─── Fetch Todo issues with relations ────────────────────────────────────────

fetch_todo_issues() {
  linear_api '{
    issues(
      filter: {
        team: { key: { eq: "HON" } }
        state: { id: { eq: "'"$STATE_TODO"'" } }
      }
      first: 50
    ) {
      nodes {
        id
        identifier
        title
        priority
        branchName
        assignee { id }
        labels { nodes { name } }
        relations {
          nodes {
            type
            relatedIssue {
              id identifier
              state { id name }
            }
          }
        }
        inverseRelations {
          nodes {
            type
            issue {
              id identifier
              state { id name }
            }
          }
        }
      }
    }
  }'
}

# ─── Select next issue ──────────────────────────────────────────────────────
# Returns: "uuid<TAB>identifier<TAB>branchName<TAB>title" or empty
# Side effect: one log line per skipped candidate ("[SKIP] HON-XX <reason>") so
# a stuck issue (assigned, or blocked by something that never clears) is
# visible in the orchestrator log instead of being dropped silently every poll.

select_next_issue() {
  local response="$1"

  # Build comma-separated list of running worker issue IDs
  local running=""
  for issue in ${WORKER_ISSUES[@]+"${WORKER_ISSUES[@]}"}; do
    running="${running:+$running,}$issue"
  done

  # jq emits "SKIP<TAB>level<TAB>identifier<TAB>reason" per rejected candidate,
  # then at most one "PICK<TAB>uuid<TAB>identifier<TAB>branchName<TAB>title".
  local line kind level id reason skip_key
  local gated="$GATED_ISSUES"
  while IFS= read -r line; do
    kind="${line%%$'\t'*}"
    case "$kind" in
      SKIP)
        IFS=$'\t' read -r kind level id reason <<< "$line"
        # Dedupe per issue+reason so a blocked issue logs once, not every poll.
        skip_key="$id"$'\t'"$reason"
        if ! grep -qxF -- "$skip_key" "$SEEN_SKIPS_FILE" 2>/dev/null; then
          log "$level" "[SKIP] $id $reason"
          printf '%s\n' "$skip_key" >> "$SEEN_SKIPS_FILE"
        fi
        ;;
      UNGATE)
        IFS=$'\t' read -r kind id <<< "$line"
        # Operator removed the Gated label — drop the stale in-memory entry so
        # the issue is eligible again (this poll already treats it as un-gated).
        local rebuilt="" g
        IFS=',' read -ra _gated_arr <<< "$GATED_ISSUES"
        for g in ${_gated_arr[@]+"${_gated_arr[@]}"}; do
          [ "$g" = "$id" ] && continue
          rebuilt="${rebuilt:+$rebuilt,}$g"
        done
        GATED_ISSUES="$rebuilt"
        log INFO "[UNGATE] $id — Gated label removed by operator; eligible again"
        ;;
      PICK)
        printf '%s\n' "${line#PICK$'\t'}"
        ;;
    esac
  done < <(echo "$response" | jq -r \
    --arg running "$running" \
    --arg gated "$gated" \
    --arg done "$STATE_DONE" \
    --arg canceled "$STATE_CANCELED" \
    --arg duplicate "$STATE_DUPLICATE" '
    # A blocker only clears when Done or Canceled. Duplicate never clears on
    # its own (a human must follow duplicateOf or fix the relation) — this
    # mirrors the /auto-implement, /implement-issue and /next-issue gates.
    [$done, $canceled] as $terminal |
    (if $running == "" then [] else ($running | split(",")) end) as $running_list |
    (if $gated == "" then [] else ($gated | split(",")) end) as $gated_list |

    .data.issues.nodes
    | map(. + {
        _running: (.identifier as $id | ($running_list | index($id)) != null),
        # Gated this run (in-memory). The durable gate is the label below; this
        # entry exists so a gated issue cannot be respawned even when the label
        # write failed. When the label is ABSENT while the in-memory entry
        # remains, an operator removed the label — the documented retry signal —
        # so the entry is stale and must un-gate (emitted as an UNGATE line,
        # handled in the bash loop). Without this, a running orchestrator
        # ignores label removal until restart (HON-562, 2026-08-30).
        _gated: (.identifier as $id | ($gated_list | index($id)) != null),
        # Durable form of the gate: the label survives restarts, so a
        # deterministic 0-commit issue is not re-picked every run. `Stranded`
        # gates for a different reason but needs the same treatment: that path
        # deliberately preserves the worktree, and `wt auto` hard-exits when one
        # already exists (worktree-claude.sh:568), so re-picking the issue would
        # fail the worker in seconds and land it in Backlog via handle_failure.
        # Holds the matching label NAME (or null) rather than a boolean, so the
        # SKIP line can name the label the operator actually has to remove.
        _gate_label: ([.labels.nodes[]?.name] | map(select(. == "Gated" or . == "Stranded")) | .[0]),
        # Any assigned issue belongs to someone — including the operator, who
        # may have self-assigned a Todo issue to work on by hand. Same rule as
        # /next-issue step 4 and /auto-implement 1.4 (assignee must be null).
        # Issues a previous run assigned to "me" are not stranded by this:
        # move_to_backlog clears the assignee when it fails an issue back to
        # Backlog, so a human re-triage to Todo makes it pickable again; RETRY
        # re-spawns the same worker without re-entering selection.
        _assigned: (.assignee != null),
        # Open blockers a worker is NOT already handling. Excluding in-worker
        # blockers keeps the two skip branches disjoint, so the open-blocker
        # branch (and its Duplicate warning) reports whenever a real blocker is
        # still waiting — even when another blocker is being worked on.
        _open_blockers: ([
          .inverseRelations.nodes[]
          | select(.type == "blocks")
          | .issue
          | select(.state.id as $s | ($terminal | index($s)) == null)
          | select(.identifier as $bid | ($running_list | index($bid)) == null)
        ]),
        _blockers_in_worker: ([
          .inverseRelations.nodes[]
          | select(.type == "blocks")
          | .issue.identifier
          | select(. as $bid | ($running_list | index($bid)) != null)
        ]),
        _blocks_count: ([
          .relations.nodes[] | select(.type == "blocks")
        ] | length)
      })
    | map(. + {
        _skip: (
          if ._running then ["DEBUG", "already running"]
          # Only the label gates; a stale in-memory entry (label removed) is
          # cleaned up via the UNGATE line and the candidate stays eligible.
          elif ._gate_label == "Gated" then ["INFO", "gated (a worker exited with 0 commits) — fix the cause, then remove the Gated label or re-triage to retry"]
          elif ._gate_label == "Stranded" then ["INFO", "stranded (a worker left an unmerged PR; its worktree is preserved) — finish or close the PR, release with `wt cleanup <branch>`, then remove the Stranded label"]
          elif ._assigned then ["INFO", "assigned"]
          elif (._open_blockers | length) > 0 then
            ["INFO",
             "blocked by " + (._open_blockers | map(.identifier + " (" + .state.name + ")") | join(", "))
             + (if any(._open_blockers[]; .state.id == $duplicate)
                then " — a Duplicate blocker never clears on its own; follow its duplicateOf or fix the relation"
                else "" end)]
          elif (._blockers_in_worker | length) > 0 then
            ["DEBUG", "blocker " + (._blockers_in_worker | join(", ")) + " is being worked on"]
          else null end)
      })
    # One UNGATE line per stale in-memory gate (label removed by operator)
    | (.[] | select(._gated and (._gate_label | not)) | ["UNGATE", .identifier] | @tsv),
    # One SKIP line per rejected candidate
      (.[] | select(._skip != null) | ["SKIP", ._skip[0], .identifier, ._skip[1]] | @tsv),
    # Sort survivors: blocks others first (desc), then priority (asc, 0=no priority→5)
      ([.[] | select(._skip == null)]
       | sort_by([(._blocks_count * -1), (if .priority == 0 then 5 else .priority end)])
       | if length > 0 then .[0] | ["PICK", .id, .identifier, (.branchName // ""), .title] | @tsv
         else empty end)
  ')
}

# ─── Claim issue (move to In Progress) ──────────────────────────────────────

claim_issue() {
  local issue_uuid="$1" issue_id="$2"

  if [ "$DRY_RUN" = true ]; then
    log INFO "[DRY RUN] Would claim $issue_id (move to In Progress)"
    return 0
  fi

  local vars
  vars=$(jq -n --arg id "$issue_uuid" --arg state "$STATE_IN_PROGRESS" \
    '{id: $id, stateId: $state}')

  local response
  response=$(linear_api \
    'mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        success
      }
    }' "$vars") || return 1

  local success
  success=$(echo "$response" | jq -r '.data.issueUpdate.success')

  if [ "$success" = "true" ]; then
    log INFO "Claimed $issue_id → In Progress"
    return 0
  else
    log ERROR "Failed to claim $issue_id"
    return 1
  fi
}

# ─── Spawn worker ───────────────────────────────────────────────────────────

spawn_worker() {
  local issue_uuid="$1" issue_id="$2" branch="$3" title="$4"
  local is_retry="${5:-0}"
  local ts
  ts=$(date '+%Y%m%d-%H%M%S')
  local log_file="$LOG_DIR/worker-${issue_id}-${ts}.log"

  # Determine the argument for wt auto and the actual branch it will create
  local wt_arg actual_branch
  if [ -n "$branch" ] && [[ "$branch" == *"/"* ]]; then
    wt_arg="$branch"
    actual_branch="$branch"
  else
    wt_arg="$issue_id"
    actual_branch="auto/$(echo "$issue_id" | tr '[:upper:]' '[:lower:]')"
  fi

  if [ "$DRY_RUN" = true ]; then
    log INFO "[DRY RUN] Would spawn worker for $issue_id: $title"
    log INFO "[DRY RUN]   Branch: $actual_branch | Log: $log_file"
    return 0
  fi

  log INFO "Spawning worker for $issue_id: $title"
  log INFO "  Branch: $actual_branch | Log: $log_file"

  "$SCRIPT_DIR/worktree-claude.sh" auto "$wt_arg" > "$log_file" 2>&1 &
  local pid=$!

  WORKER_PIDS+=("$pid")
  WORKER_ISSUES+=("$issue_id")
  WORKER_ISSUE_UUIDS+=("$issue_uuid")
  WORKER_BRANCHES+=("$actual_branch")
  WORKER_LOGS+=("$log_file")
  WORKER_START_TIMES+=("$(date +%s)")
  WORKER_RETRIED+=("$is_retry")
  WORKER_TITLES+=("$title")

  log INFO "Worker started (PID $pid)"
  write_status_file
}

# ─── Monitor workers ────────────────────────────────────────────────────────

monitor_workers() {
  local i=0
  local to_remove=()

  while [ $i -lt ${#WORKER_PIDS[@]} ]; do
    local pid="${WORKER_PIDS[$i]}"
    local issue_id="${WORKER_ISSUES[$i]}"
    local issue_uuid="${WORKER_ISSUE_UUIDS[$i]}"
    local branch="${WORKER_BRANCHES[$i]}"
    local log_file="${WORKER_LOGS[$i]}"
    local start_time="${WORKER_START_TIMES[$i]}"
    local retried="${WORKER_RETRIED[$i]}"
    local title="${WORKER_TITLES[$i]}"

    if kill -0 "$pid" 2>/dev/null; then
      # Still running — check timeout
      local now elapsed
      now=$(date +%s)
      elapsed=$((now - start_time))

      if [ "$elapsed" -ge "$WORKER_TIMEOUT" ]; then
        log WARN "Worker $issue_id (PID $pid) timed out after ${elapsed}s"
        # Capture last activity before killing for triage context
        if [ -f "$log_file" ]; then
          local last_activity
          last_activity=$(tail -20 "$log_file" 2>/dev/null || echo "(unreadable)")
          log DEBUG "Timeout context for $issue_id (last 20 lines before kill):"
          printf '%s\n' "$last_activity" >> "$MAIN_LOG"
        fi
        kill_process_tree "$pid"
        sleep 2
        handle_failure "$issue_id" "$issue_uuid" "$branch" "$log_file" "$retried" "timeout" "$title"
        to_remove+=("$i")
      fi
    else
      # Process exited
      local exit_code=0
      wait "$pid" 2>/dev/null || exit_code=$?

      if [ "$exit_code" -eq 0 ]; then
        log INFO "Worker $issue_id (PID $pid) exited cleanly (exit 0)"
        handle_success "$issue_id" "$issue_uuid" "$branch" "$log_file"
      else
        log WARN "Worker $issue_id (PID $pid) failed (exit $exit_code)"
        handle_failure "$issue_id" "$issue_uuid" "$branch" "$log_file" "$retried" "exit:$exit_code" "$title"
      fi
      to_remove+=("$i")
    fi

    i=$((i + 1))
  done

  # Remove completed workers in reverse order to preserve indices
  local j=${#to_remove[@]}
  while [ "$j" -gt 0 ]; do
    j=$((j - 1))
    remove_worker "${to_remove[$j]}"
  done
}

# ─── Report worker status ────────────────────────────────────────────────

report_worker_status() {
  local count=${#WORKER_PIDS[@]}
  [ "$count" -eq 0 ] && return 0

  local now
  now=$(date +%s)

  log DEBUG "── Active workers: $count/$MAX_WORKERS ──"

  local i=0
  while [ $i -lt $count ]; do
    local issue_id="${WORKER_ISSUES[$i]}"
    local branch="${WORKER_BRANCHES[$i]}"
    local start_time="${WORKER_START_TIMES[$i]}"

    local elapsed=$(( now - start_time ))
    local mins=$(( elapsed / 60 ))
    local secs=$(( elapsed % 60 ))

    # Check git activity in the worktree for real progress signal
    local status=""
    local wt_path
    wt_path=$(get_worktree_path "$branch")

    if [ -d "$wt_path/.git" ] || [ -f "$wt_path/.git" ]; then
      # Count commits ahead of main
      local ahead=0
      ahead=$(git -C "$wt_path" rev-list --count main..HEAD 2>/dev/null) || true
      # Empty on failure, and `[ "" -gt 0 ]` is a hard error — see detect_phase.
      [[ "$ahead" =~ ^[0-9]+$ ]] || ahead=0

      # Last commit message (if any commits made)
      local last_msg=""
      if [ "$ahead" -gt 0 ]; then
        last_msg=$(git -C "$wt_path" log -1 --format='%s' 2>/dev/null | cut -c1-80) || true
      fi

      # Check for uncommitted changes or untracked files as a sign of active work
      local dirty=""
      if [ -z "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ]; then
        dirty=""
      else
        dirty=" [working]"
      fi

      if [ "$ahead" -gt 0 ]; then
        status="${ahead} commit(s)${dirty} — ${last_msg}"
      elif [ -n "$dirty" ]; then
        status="uncommitted changes"
      else
        status="no commits yet"
      fi
    else
      status="worktree initializing"
    fi

    # log DEBUG already writes this row to stderr AND to $MAIN_LOG. A second
    # printf to stderr made every row land twice (three times once cmd_start's
    # `2>&1` folded stderr back into the same file) — HON-572.
    log DEBUG "  $(printf '%-8s %3dm%02ds  %s' "$issue_id" "$mins" "$secs" "$status")"

    i=$((i + 1))
  done
}

remove_worker() {
  local idx="$1"
  local new_pids=() new_issues=() new_uuids=() new_branches=()
  local new_logs=() new_starts=() new_retried=() new_titles=()

  local i=0
  while [ $i -lt ${#WORKER_PIDS[@]} ]; do
    if [ "$i" -ne "$idx" ]; then
      new_pids+=("${WORKER_PIDS[$i]}")
      new_issues+=("${WORKER_ISSUES[$i]}")
      new_uuids+=("${WORKER_ISSUE_UUIDS[$i]}")
      new_branches+=("${WORKER_BRANCHES[$i]}")
      new_logs+=("${WORKER_LOGS[$i]}")
      new_starts+=("${WORKER_START_TIMES[$i]}")
      new_retried+=("${WORKER_RETRIED[$i]}")
      new_titles+=("${WORKER_TITLES[$i]}")
    fi
    i=$((i + 1))
  done

  if [ ${#new_pids[@]} -gt 0 ]; then
    WORKER_PIDS=("${new_pids[@]}")
    WORKER_ISSUES=("${new_issues[@]}")
    WORKER_ISSUE_UUIDS=("${new_uuids[@]}")
    WORKER_BRANCHES=("${new_branches[@]}")
    WORKER_LOGS=("${new_logs[@]}")
    WORKER_START_TIMES=("${new_starts[@]}")
    WORKER_RETRIED=("${new_retried[@]}")
    WORKER_TITLES=("${new_titles[@]}")
  else
    WORKER_PIDS=()
    WORKER_ISSUES=()
    WORKER_ISSUE_UUIDS=()
    WORKER_BRANCHES=()
    WORKER_LOGS=()
    WORKER_START_TIMES=()
    WORKER_RETRIED=()
    WORKER_TITLES=()
  fi

  write_status_file
}

# ─── Kill process tree (macOS compatible) ────────────────────────────────────

kill_process_tree() {
  local pid="$1" sig="${2:-TERM}"
  local children
  children=$(pgrep -P "$pid" 2>/dev/null) || true
  for child in $children; do
    kill_process_tree "$child" "$sig"
  done
  kill "-$sig" "$pid" 2>/dev/null || true
}

# Poll until $1 has exited; $2 = half-second ticks to wait (default 20 = 10s).
# Returns 1 if the process is still alive afterwards.
wait_for_exit() {
  local pid="$1" ticks="${2:-20}"
  while [ "$ticks" -gt 0 ] && kill -0 "$pid" 2>/dev/null; do
    sleep 0.5
    ticks=$((ticks - 1))
  done
  ! kill -0 "$pid" 2>/dev/null
}

# ─── Observability helpers ───────────────────────────────────────────────────

# Detect the current phase from worker log markers + git state heuristics
detect_phase() {
  local log_file="$1"
  local branch="${2:-}"
  [ ! -f "$log_file" ] && echo "unknown" && return

  # Strategy 1: Check for individual skill markers (step-by-step workflow)
  local last_marker
  last_marker=$(grep -o '\[[^]]*:complete\]' "$log_file" 2>/dev/null | tail -1) || true
  case "$last_marker" in
    "[plan-issue:complete]")      echo "implementing"; return ;;
    "[implement-issue:complete]") echo "reviewing"; return ;;
    "[branch-review:complete]")   echo "committing"; return ;;
    "[commit:complete]")          echo "pr-review"; return ;;
    "[create-pr:complete]")       echo "pr-review"; return ;;
    "[review-pr:complete]")       echo "merging"; return ;;
    "[merge:complete]")           echo "done"; return ;;
  esac

  # Strategy 2: Check for auto-implement completion in log
  if grep -qE '\[auto-implement\].*(cycle complete|PR merged)' "$log_file" 2>/dev/null; then
    echo "done"; return
  fi

  # Strategy 3: Git-based heuristics (reliable for auto-implement workers)
  if [ -n "$branch" ]; then
    local wt_path
    wt_path=$(get_worktree_path "$branch")
    if [ -d "$wt_path/.git" ] || [ -f "$wt_path/.git" ]; then
      # Commits ahead of main, computed first because it gates the pushed
      # check below.
      local ahead=0
      ahead=$(git -C "$wt_path" rev-list --count main..HEAD 2>/dev/null) || true
      # rev-list prints nothing when it fails (a pruned worktree admin dir, say),
      # and `[ "" -gt 0 ]` is a hard error that logs `integer expression
      # expected` and silently evaluates false.
      [[ "$ahead" =~ ^[0-9]+$ ]] || ahead=0

      # Has THIS branch's work been pushed? Three conditions, each closing a
      # different false positive (HON-576):
      #
      #   ahead>0    — a branch with no commits of its own cannot be at PR stage.
      #   show-ref   — a configured upstream is NOT the same question. Autonomous
      #                worktrees branch from origin/main, and branch.autoSetupMerge
      #                turns that start ref into an upstream before a single commit
      #                exists, which is what made `@{upstream}` report pr-review
      #                from worktree creation onward.
      #   is-ancestor — the remote ref alone only proves "a remote branch by this
      #                name exists locally". Branch names are deterministic per
      #                issue and nothing prunes them, so a re-run of an issue whose
      #                earlier run pushed would inherit a stale ref and reproduce
      #                the same symptom. Requiring the remote tip to be contained
      #                in HEAD ties the answer to this worktree's own history,
      #                while still holding after the worker adds a commit on top
      #                of what it pushed.
      if [ "$ahead" -gt 0 ] &&
         git -C "$wt_path" show-ref --verify --quiet "refs/remotes/origin/$branch" &&
         git -C "$wt_path" merge-base --is-ancestor "refs/remotes/origin/$branch" HEAD 2>/dev/null; then
        echo "pr-review"; return
      fi

      if [ "$ahead" -gt 0 ]; then
        local has_dirty=""
        has_dirty=$(git -C "$wt_path" status --porcelain 2>/dev/null) || true
        if [ -n "$has_dirty" ]; then
          echo "implementing"; return
        else
          echo "reviewing"; return
        fi
      fi

      # No commits but has uncommitted changes = implementing
      if [ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ]; then
        echo "implementing"; return
      fi
    fi
  fi

  # Strategy 4: Log content fallback
  if grep -q "Starting autonomous Claude Code" "$log_file" 2>/dev/null; then
    echo "planning"
  else
    echo "initializing"
  fi
}

# Format seconds into human-readable duration
format_duration() {
  local secs="$1"
  if [ "$secs" -ge 3600 ]; then
    printf "%dh%dm" $((secs / 3600)) $(( (secs % 3600) / 60 ))
  elif [ "$secs" -ge 60 ]; then
    printf "%dm%ds" $((secs / 60)) $((secs % 60))
  else
    printf "%ds" "$secs"
  fi
}

# Count commits ahead of main in a worktree
count_commits() {
  local branch="$1"
  local wt_path
  wt_path=$(get_worktree_path "$branch")
  if [ -d "$wt_path/.git" ] || [ -f "$wt_path/.git" ]; then
    git -C "$wt_path" rev-list --count main..HEAD 2>/dev/null || echo 0
  else
    echo 0
  fi
}

# Resolve the pull request for a branch, if any.
# Prints "state<TAB>number<TAB>url" (state ∈ OPEN | CLOSED | MERGED), or nothing
# when gh is missing/unauthenticated or no PR was ever opened. Callers must
# treat "nothing" as unknown, never as "no PR therefore fine" — handle_success
# only asks this question on a path where a false SUCCESS is the failure mode.
pr_for_branch() {
  local branch="$1"
  [ -z "$branch" ] && return 0
  command -v gh &> /dev/null || return 0
  # gh resolves the repo from the working directory. The orchestrator can be
  # started from anywhere, so pin it to REPO_ROOT in a subshell rather than
  # inheriting whatever cwd the operator happened to have.
  # `.[0] // empty` matters: on an empty result `.[0]` is null and the array
  # construction would emit a literal "<TAB>null<TAB>" row, which reads as a
  # PR numbered "null" downstream. Emit nothing instead.
  ( cd "$REPO_ROOT" && gh pr list --head "$branch" --state all --limit 1 \
      --json state,number,url --jq '.[0] // empty | [.state, (.number|tostring), .url] | @tsv' \
  ) 2>/dev/null || true
}

# Summarize a PR's CI as green | pending | failing | unknown. Mirrors the
# bucket rules /auto-implement Phase 6.1 uses: pass and skipping are fine,
# pending means still running, anything else (fail/cancel) is failing.
pr_ci_state() {
  local pr_number="$1"
  [ -z "$pr_number" ] && echo "unknown" && return
  command -v gh &> /dev/null || { echo "unknown"; return; }

  local buckets
  # Same cwd pinning as pr_for_branch — without it gh cannot find the repo.
  buckets=$( ( cd "$REPO_ROOT" && gh pr checks "$pr_number" --json bucket --jq '.[].bucket' ) 2>/dev/null ) || {
    echo "unknown"; return
  }
  [ -z "$buckets" ] && { echo "unknown"; return; }

  if printf '%s\n' "$buckets" | grep -qx 'pending'; then
    echo "pending"
  elif printf '%s\n' "$buckets" | grep -qvxE 'pass|skipping'; then
    echo "failing"
  else
    echo "green"
  fi
}

# Send macOS notification
notify() {
  local title="$1" message="$2"
  if [[ "$OSTYPE" == darwin* ]]; then
    # Escape backslashes and quotes for AppleScript string interpolation
    title="${title//\\/\\\\}" ; title="${title//\"/\\\"}"
    message="${message//\\/\\\\}" ; message="${message//\"/\\\"}"
    osascript -e "display notification \"$message\" with title \"$title\"" 2>/dev/null || true
  fi
}

# ─── Handle success ─────────────────────────────────────────────────────────

# ─── Circuit breaker ─────────────────────────────────────────────────────────
# Called from every path that ends a run without shipping: all of handle_failure
# (retry included — a retry is a failure that gets another chance), the gated
# 0-commit path, and the stranded path. handle_success holds the only reset, so
# the counter means "consecutive runs that shipped nothing".

note_consecutive_failure() {
  CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
  if [ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]; then
    local pause_duration=600  # 10 minutes
    PAUSED_UNTIL=$(( $(date +%s) + pause_duration ))
    log WARN "Circuit breaker: $CONSECUTIVE_FAILURES consecutive failures, pausing new workers for ${pause_duration}s"
  fi
}

handle_success() {
  local issue_id="$1" issue_uuid="$2" branch="$3" log_file="$4"

  # Compute outcome details
  local commits duration_str phase
  commits=$(count_commits "$branch")
  phase=$(detect_phase "$log_file" "$branch")

  # Find start time for this worker to compute duration
  local duration_secs=0
  local i=0
  while [ $i -lt ${#WORKER_ISSUES[@]} ]; do
    if [ "${WORKER_ISSUES[$i]}" = "$issue_id" ]; then
      duration_secs=$(( $(date +%s) - ${WORKER_START_TIMES[$i]} ))
      break
    fi
    i=$((i + 1))
  done
  duration_str=$(format_duration "$duration_secs")

  # Resolve the PR once, ahead of BOTH incompleteness checks below. Each of them
  # condemns a run that did not reach "done", and both are wrong when the run
  # actually merged: detect_phase can miss the "[merge:complete]" marker and fall
  # through to "planning", and a merged run whose worktree is already gone counts
  # 0 commits. Confirming against the PR first keeps a lagging phase from
  # manufacturing either a false GATED or a false STRANDED. Skipped entirely when
  # the phase already says "done" — that run needs no confirmation, and this is a
  # network round-trip.
  local pr_state="" pr_number="" pr_url="" pr_info="" pr_merged=false
  if [ "$phase" != "done" ]; then
    pr_info=$(pr_for_branch "$branch")
    [ -n "$pr_info" ] && IFS=$'\t' read -r pr_state pr_number pr_url <<< "$pr_info"
    if [ "$pr_state" = "MERGED" ]; then
      log INFO "$issue_id: phase reported '$phase' but PR #$pr_number is merged — treating as success"
      pr_merged=true
    fi
  fi

  # A clean exit that produced no commits and did not reach a merge shipped
  # nothing. Logging it as SUCCESS would leave the issue In Progress and
  # assigned, which select_next_issue skips forever. Gate it instead: return the
  # issue to Todo, unassigned, so it is pickable again, and emit a distinct
  # GATED outcome operators can grep for. The phase guard matters because a
  # merged run can also show 0 commits once local main advances past its merge;
  # that run reached phase "done", so it stays a SUCCESS and Linear automation
  # moves its issue to Done.
  if [ "${commits:-0}" -eq 0 ] && [ "$phase" != "done" ] && [ "$pr_merged" = false ]; then
    log WARN "[OUTCOME] $issue_id GATED ${duration_str} 0-commits phase=$phase"
    notify "Honkadori" "$issue_id produced no commits — returned to Todo"
    gate_no_commit_success "$issue_uuid" "$issue_id" "$log_file"
    GATED_ISSUES="${GATED_ISSUES:+$GATED_ISSUES,}$issue_id"
    # A gated exit is a failure to produce, so it counts toward the circuit
    # breaker: a systemic no-op (expired auth, broken skill) must not sweep
    # the whole Todo queue one worker per poll.
    note_consecutive_failure
    [ "$RUN_ONCE" = true ] && ONCE_EXIT_CODE=1
    cleanup_worker_worktree "$branch"
    return
  fi

  # A clean exit with commits that never reached "done" did not merge anything.
  # This is the headless-worker failure mode (HON-573): the process exits the
  # moment a turn ends, so a worker that ended its turn waiting on CI dies with
  # an open, unmerged PR. Logging that as SUCCESS hid it twice over — the
  # outcome line said the cycle finished, and cleanup then deleted the worktree,
  # local branch and Neon branch that a resume needs.
  #
  # A MERGED PR (confirmed above) falls through to SUCCESS; everything else —
  # open, closed, never created, or unknowable because gh is missing — is
  # STRANDED, because on this path a false SUCCESS is the expensive answer.
  if [ "$phase" != "done" ] && [ "$pr_merged" = false ]; then
    local ci_state pr_ref="none"
    ci_state=$(pr_ci_state "$pr_number")
    [ -n "$pr_number" ] && pr_ref="#$pr_number"
    log WARN "[OUTCOME] $issue_id STRANDED ${duration_str} ${commits}-commits phase=$phase pr=${pr_ref} ci=${ci_state}"
    notify "Honkadori" "$issue_id stranded at $phase — PR $pr_ref not merged"
    record_stranded "$issue_uuid" "$issue_id" "$branch" "$log_file" "$pr_url" "$pr_ref" "$pr_state" "$ci_state" "$phase"
    # With a PR, In Review is the accurate state and record_stranded leaves it
    # alone. With no PR — none opened, or gh missing/unauthenticated, which
    # validate_environment only WARNs about — Linear never moved the issue, so
    # it is still In Progress and assigned where claim_issue and /auto-implement
    # Phase 2.2 left it. fetch_todo_issues queries Todo only and
    # select_next_issue skips assigned issues, so it would never be seen again.
    # Hand it back the way gate_no_commit_success does; the Stranded label added
    # by record_stranded keeps the picker off it until an operator clears it.
    if [ -z "$pr_number" ]; then
      restore_todo_if_in_progress "$issue_uuid" "$issue_id"
    fi
    # An incomplete cycle is a failure to ship, so it counts toward the
    # circuit breaker: a systemic stranding must not walk the whole Todo
    # queue one worker per poll.
    note_consecutive_failure
    [ "$RUN_ONCE" = true ] && ONCE_EXIT_CODE=1
    # Deliberately no cleanup_worker_worktree: the worktree, local branch and
    # Neon branch are exactly what finishing this run by hand requires. Nothing
    # reclaims them once the operator is done, so the release command has to
    # travel with the resume command — otherwise every stranded run leaks a
    # worktree (a full pnpm install) and blocks any respawn on that branch.
    log WARN "Preserved worktree and branch for $issue_id — resume with: wt resume $branch (release with: wt cleanup $branch)"
    return
  fi

  # Reset circuit breaker on a real success
  CONSECUTIVE_FAILURES=0
  PAUSED_UNTIL=0

  log INFO "[OUTCOME] $issue_id SUCCESS ${duration_str} ${commits}-commits phase=$phase"
  notify "Honkadori" "$issue_id completed ($commits commits, $duration_str)"

  # Track success for --once exit code
  [ "$RUN_ONCE" = true ] && ONCE_EXIT_CODE=0

  log INFO "Cleaning up worktree for $issue_id"
  cleanup_worker_worktree "$branch"
  log INFO "Worker $issue_id complete — worktree cleaned up"
}

# ─── Gate a no-commit "success" ──────────────────────────────────────────────
# A worker can exit 0 without producing anything. Comment on the issue, then
# return it to Todo and clear the assignee (reusing move_issue_unassigned) so a
# later run can pick it up instead of it being stranded In Progress.

gate_no_commit_success() {
  local issue_uuid="$1" issue_id="$2" log_file="$3"

  local log_path_note=""
  [ -n "$log_file" ] && log_path_note=$(printf '\n\n**Full log:** `%s`' "$log_file")

  local body
  body=$(printf '## Auto-implementation produced no commits\n\nThe worker exited cleanly but made no commits, so nothing shipped. Returned to Todo, unassigned, and labelled `Gated`. The orchestrator skips `Gated` issues; once the cause is fixed, remove the label (or re-triage) to make it pickable again.%s' \
    "$log_path_note")

  local vars
  vars=$(jq -n --arg id "$issue_uuid" --arg body "$body" '{issueId: $id, body: $body}')
  linear_api \
    'mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success }
    }' "$vars" > /dev/null 2>&1 || log WARN "Failed to comment on $issue_id"

  try_add_label "$issue_uuid" "Gated"
  restore_todo_if_in_progress "$issue_uuid" "$issue_id"
  log INFO "Gated $issue_id → Todo (unassigned, labelled Gated, 0 commits)"
}

# ─── Record a stranded (unmerged) run ────────────────────────────────────────
# The worker exited cleanly with commits but never merged. Make that visible
# where a human will look — on the issue itself — rather than only in
# orchestrator.log. This function only adds the label and the comment; it never
# touches issue state, because with an open PR Linear automation has already
# moved the issue to In Review and that is the accurate state. The no-PR case,
# where nothing moved the issue at all, is handled by the caller.

record_stranded() {
  local issue_uuid="$1" issue_id="$2" branch="$3" log_file="$4"
  local pr_url="$5" pr_ref="$6" pr_state="$7" ci_state="$8" phase="$9"

  # pr_ref is "#650" — the shape the outcome log line wants. Every operator
  # instruction below needs the bare number instead: `gh pr merge` rejects a
  # leading "#" as a ref, and a shell pasting the command reads "#650" as the
  # start of a comment and silently drops the argument.
  local pr_num="${pr_ref#\#}"

  # OPEN and CLOSED must not read the same. A deliberately-closed PR handed a
  # "merge it" instruction either wastes the operator's time or, worse, gets
  # work someone closed on purpose reopened and merged.
  local pr_note="No PR could be resolved for \`$branch\` — either none was opened, or \`gh\` is unavailable to this orchestrator."
  if [ -n "$pr_url" ] && [ "$pr_state" = "OPEN" ]; then
    pr_note=$(printf '**Open PR:** %s (CI: `%s`)' "$pr_url" "$ci_state")
  elif [ -n "$pr_url" ]; then
    pr_note=$(printf '**PR %s — %s, never merged** (CI: `%s`)' "$pr_url" "$pr_state" "$ci_state")
  fi

  local log_path_note=""
  [ -n "$log_file" ] && log_path_note=$(printf '\n**Worker log:** `%s`' "$log_file")

  local next_step
  if [ "$pr_state" = "OPEN" ]; then
    next_step="Review the PR, then merge it by hand once CI is green."
    case "$ci_state" in
      green)   next_step=$(printf 'CI is green — this run is one `gh pr merge --squash %s` from done.' "$pr_num") ;;
      failing) next_step="CI is failing — fix on the preserved branch, push, then merge." ;;
      pending) next_step="CI is still running — wait for it, then merge." ;;
    esac
  elif [ -n "$pr_url" ]; then
    next_step=$(printf 'The PR is %s and was never merged — reopen it (`gh pr reopen %s`) or open a fresh one from the preserved branch. Do not assume it can be merged as-is.' "$pr_state" "$pr_num")
  else
    next_step="No PR exists for this branch. Resume the worktree and finish the cycle by hand, or check that \`gh\` is installed and authenticated for the orchestrator."
  fi

  local body
  body=$(printf '## Auto-implementation stranded at `%s`\n\nThe worker exited cleanly but never merged, so the cycle is incomplete. %s%s\n\n**Preserved for resume:** the worktree, local branch `%s` and its Neon branch were *not* cleaned up. Resume with `wt resume %s`, and release them with `wt cleanup %s` once the run is finished — nothing else reclaims them.\n\n%s' \
    "$phase" "$pr_note" "$log_path_note" "$branch" "$branch" "$branch" "$next_step")

  local vars
  vars=$(jq -n --arg id "$issue_uuid" --arg body "$body" '{issueId: $id, body: $body}')
  linear_api \
    'mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success }
    }' "$vars" > /dev/null 2>&1 || log WARN "Failed to comment on $issue_id"

  try_add_label "$issue_uuid" "Stranded"
  log WARN "Stranded $issue_id at phase=$phase (pr=$pr_ref ci=$ci_state) — artifacts preserved"
}

# ─── Sanitize logs (strip secrets before posting to Linear) ──────────────────

sanitize_log() {
  local log_text="$1"
  local env_file="$REPO_ROOT/.env"
  local result="$log_text"

  # Redact actual values from .env (skip short/trivial values)
  if [ -f "$env_file" ]; then
    while IFS= read -r line; do
      [[ "$line" =~ ^[[:space:]]*#.*$ || -z "$line" || ! "$line" =~ = ]] && continue
      local value="${line#*=}"
      # Strip surrounding quotes
      value="${value%\"}" ; value="${value#\"}"
      value="${value%\'}" ; value="${value#\'}"
      # Only redact values >= 8 chars to avoid false positives
      [ ${#value} -lt 8 ] && continue
      # LITERAL replacement, not regex. awk's gsub() treats its first argument
      # as an ERE, so a secret containing any of `+ ? . * [ ] ( ) \ ^ $ |` —
      # a base64 BETTER_AUTH_SECRET, most API keys — fails to match itself and
      # was posted to Linear unredacted (HON-572). index()/substr() cannot be
      # got wrong the way escaping-into-a-regex can. The loop keeps gsub's
      # global semantics: every occurrence on the line is replaced.
      # ENVIRON is used rather than -v so backslashes survive unescaped.
      result=$(printf '%s' "$result" | VALUE="$value" awk '
        BEGIN { s = ENVIRON["VALUE"]; r = "[REDACTED]"; n = length(s) }
        {
          line = $0; out = ""
          while (n > 0 && (p = index(line, s)) > 0) {
            out = out substr(line, 1, p - 1) r
            line = substr(line, p + n)
          }
          print out line
        }')
    done < "$env_file"
  fi

  # Catch common secret patterns not covered by .env
  printf '%s' "$result" | sed -E \
    -e 's/lin_api_[A-Za-z0-9_-]+/[REDACTED]/g' \
    -e 's/postgresql:\/\/[^[:space:]"]+/[REDACTED]/g' \
    -e 's/Bearer [A-Za-z0-9._-]+/Bearer [REDACTED]/g' \
    -e 's/sk-[A-Za-z0-9_-]{20,}/[REDACTED]/g' \
    -e 's/ghp_[A-Za-z0-9]{36,}/[REDACTED]/g'
}

# ─── Extract Claude output from worker log ───────────────────────────────────
# Strips worktree setup noise (pnpm install, prisma generate, etc.)
# Returns only the output after "Starting autonomous Claude Code" marker

extract_claude_output() {
  local log_file="$1"
  local marker="Starting autonomous Claude Code"
  local output

  # Find content after the setup marker
  # sed captures from marker to EOF; tail -n +3 skips the marker + separator line
  output=$(sed -n "/$marker/,\$p" "$log_file" 2>/dev/null | tail -n +3) || true

  if [ -n "$output" ]; then
    # Return last 50 lines of Claude output (enough context without noise)
    printf '%s' "$output" | tail -50
  else
    # Marker not found — fall back to last 30 lines of raw log
    tail -30 "$log_file" 2>/dev/null || echo "(log not readable)"
  fi
}

# ─── Handle failure ─────────────────────────────────────────────────────────

handle_failure() {
  local issue_id="$1" issue_uuid="$2" branch="$3" log_file="$4"
  local retried="$5" failure_type="$6" title="${7:-}"

  log WARN "Triaging failure for $issue_id ($failure_type)"

  # Compute outcome details for logging and notifications
  local commits phase duration_secs=0 duration_str original_title=""
  commits=$(count_commits "$branch")
  phase=$(detect_phase "$log_file" "$branch")
  local i=0
  while [ $i -lt ${#WORKER_ISSUES[@]} ]; do
    if [ "${WORKER_ISSUES[$i]}" = "$issue_id" ]; then
      duration_secs=$(( $(date +%s) - ${WORKER_START_TIMES[$i]} ))
      original_title="${WORKER_TITLES[$i]}"
      break
    fi
    i=$((i + 1))
  done
  duration_str=$(format_duration "$duration_secs")

  # Get log tail for triage (full tail) and comment (Claude output only)
  local log_tail="(no log)"
  local log_claude_output="(no log)"
  local timeout_context=""
  if [ -f "$log_file" ]; then
    log_tail=$(tail -200 "$log_file" 2>/dev/null || echo "(log not readable)")
    # Extract only the Claude session output (after worktree setup completes)
    # Falls back to last 30 lines if marker not found
    log_claude_output=$(extract_claude_output "$log_file")
    # For timeouts, capture the last 20 lines as focused context
    if [ "$failure_type" = "timeout" ]; then
      timeout_context=$(tail -20 "$log_file" 2>/dev/null || echo "(unreadable)")
    fi
  fi

  # Claude-powered triage (default to BACKLOG if Claude unavailable, NEEDS_HUMAN if Claude errors)
  local triage="BACKLOG"
  if command -v claude &> /dev/null && [ "$DRY_RUN" = false ]; then
    # Build triage prompt with timeout context if available
    local triage_extra=""
    if [ -n "$timeout_context" ]; then
      triage_extra="
Worker was in phase: $phase (${duration_str}, ${commits} commits).
Last 20 lines before kill:
$timeout_context"
    fi

    local triage_output exit_code=0
    triage_output=$(echo "$log_tail" | env -u ANTHROPIC_API_KEY claude -p --model claude-sonnet-5 "Worker for $issue_id failed ($failure_type).${triage_extra}

Based on the log from stdin, respond with EXACTLY one word:
RETRY - transient failure (flaky test, network error, rate limit, timeout)
BACKLOG - issue needs refinement (bad description, missing context, wrong approach)
NEEDS_HUMAN - infrastructure problem (disk space, auth expired, config broken)" 2>&1) || exit_code=$?

    # Extract first word only — Claude may include explanatory text after the keyword
    local triage_result
    triage_result=$(printf '%s' "$triage_output" | awk 'NF{print $1; exit}' | tr -d '[:space:]')

    if [ "$exit_code" -ne 0 ]; then
      log WARN "Claude triage failed (exit $exit_code): $(printf '%s' "$triage_output" | head -1)"
      triage="NEEDS_HUMAN"
    else
      case "$triage_result" in
        RETRY|BACKLOG|NEEDS_HUMAN) triage="$triage_result" ;;
        *)
          log WARN "Unexpected triage result: '$triage_result'"
          # Detect Claude CLI errors returned on stdout
          if printf '%s' "$triage_output" | grep -qiE 'balance|credit|limit|unauthorized|forbidden'; then
            log WARN "Looks like a Claude CLI error, treating as NEEDS_HUMAN"
            triage="NEEDS_HUMAN"
          fi ;;
      esac
    fi
  fi

  log INFO "Triage for $issue_id: $triage"

  # Structured outcome logging
  local failure_label
  case "$failure_type" in
    timeout) failure_label="TIMEOUT" ;;
    *)       failure_label="FAILED" ;;
  esac
  log INFO "[OUTCOME] $issue_id $failure_label ${duration_str} ${commits}-commits phase=$phase triage=$triage"
  notify "Honkadori" "$issue_id failed in $phase phase ($failure_type, $duration_str)"

  # Track failure for --once exit code (may be overridden to 0 if retry succeeds)
  [ "$RUN_ONCE" = true ] && ONCE_EXIT_CODE=1

  # Every path out of handle_failure is a failure to ship, so every one of them
  # counts toward the circuit breaker — including the retry, which is a failure
  # that gets another chance, not a success. handle_success owns the only reset
  # in the script (see "Reset circuit breaker on a real success"), which is what
  # makes CONSECUTIVE_FAILURES mean "consecutive runs that shipped nothing".
  #
  # HON-572: the counter used to be driven by the triage VERDICT — reset on
  # RETRY, incremented otherwise — before the case that acts on it. A systemic
  # fault whose logs read as transient (rate limit, network flake, the literal
  # word "timeout") produced fail -> RETRY -> fail -> Backlog per issue and
  # zeroed the counter every cycle, so MAX_CONSECUTIVE_FAILURES was never
  # reached and the orchestrator swept the whole Todo queue into Backlog one
  # issue per poll. Moving the reset onto the spawn_worker branch is NOT enough
  # either: that branch runs on every issue's FIRST failure, so under the same
  # systemic fault the counter just oscillates 0 -> 1 -> 0 and still never
  # reaches the threshold. The breaker only works if nothing here resets it.
  note_consecutive_failure

  case "$triage" in
    RETRY)
      if [ "$retried" = "0" ] && [ "$SHUTTING_DOWN" = false ]; then
        log INFO "Retrying $issue_id: $title"
        # Keep the branch so a respawn can resume an already-pushed branch / open PR.
        cleanup_worker_worktree "$branch" true
        # Preserve original title on retry (from WORKER_TITLES array)
        spawn_worker "$issue_uuid" "$issue_id" "$branch" "$original_title" "1"
      else
        if [ "$SHUTTING_DOWN" = true ]; then
          log WARN "$issue_id failed during shutdown, moving to Backlog"
        else
          log WARN "$issue_id already retried, moving to Backlog"
        fi
        move_to_backlog "$issue_uuid" "$issue_id" "$log_claude_output" "Failed" \
          "Auto-implementation failed after retry ($failure_type)" "$log_file"
        cleanup_worker_worktree "$branch"
      fi ;;
    BACKLOG)
      move_to_backlog "$issue_uuid" "$issue_id" "$log_claude_output" "Failed" \
        "Auto-implementation failed ($failure_type)" "$log_file"
      cleanup_worker_worktree "$branch" ;;
    NEEDS_HUMAN)
      move_to_backlog "$issue_uuid" "$issue_id" "$log_claude_output" "Needs attention" \
        "Auto-implementation needs human attention ($failure_type)" "$log_file"
      cleanup_worker_worktree "$branch" ;;
  esac
}

# ─── Move issue to Backlog with comment + label ─────────────────────────────

move_to_backlog() {
  local issue_uuid="$1" issue_id="$2" log_tail="$3"
  local label_name="$4" summary="$5" log_file="${6:-}"

  # Sanitize log to strip secrets before posting to Linear
  local sanitized_tail
  sanitized_tail=$(sanitize_log "$log_tail")

  # Add failure comment
  local log_path_note=""
  if [ -n "$log_file" ]; then
    log_path_note=$(printf '\n\n**Full log:** `%s`' "$log_file")
  fi

  local body
  body=$(printf '## Auto-implementation failed\n\n**%s**%s\n\n<details>\n<summary>Claude output</summary>\n\n```\n%s\n```\n\n</details>' \
    "$summary" "$log_path_note" "$sanitized_tail")

  local vars
  vars=$(jq -n --arg id "$issue_uuid" --arg body "$body" '{issueId: $id, body: $body}')
  linear_api \
    'mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success }
    }' "$vars" > /dev/null 2>&1 || log WARN "Failed to comment on $issue_id"

  # Try to add label (best-effort)
  try_add_label "$issue_uuid" "$label_name"

  # Move to Backlog and clear the assignee. /auto-implement 2.2 assigns the
  # issue to the API user; leaving that in place would make select_next_issue
  # skip the issue as "assigned" forever once a human re-triages it to Todo.
  move_issue_unassigned "$issue_uuid" "$issue_id" "$STATE_BACKLOG" "Backlog"

  log INFO "Moved $issue_id to Backlog (unassigned) with '$label_name' label"
}

# ─── Restore Todo only from In Progress ──────────────────────────────────────
# The gated path and the force-kill drain must not stomp a state the worker
# (or Linear's PR automation) already advanced: a merged run whose worktree
# is gone can detect_phase as "planning", and a killed worker may already
# have a PR open (In Review). Only the orchestrator's own claim — In
# Progress — is undone.

issue_state_id() {
  local issue_uuid="$1"
  linear_api '{ issue(id: "'"$issue_uuid"'") { state { id } } }' 2>/dev/null \
    | jq -r '.data.issue.state.id // empty'
}

restore_todo_if_in_progress() {
  local issue_uuid="$1" issue_id="$2"
  local state_id
  state_id=$(issue_state_id "$issue_uuid") || true
  if [ "$state_id" = "$STATE_IN_PROGRESS" ]; then
    move_issue_unassigned "$issue_uuid" "$issue_id" "$STATE_TODO" "Todo"
  elif [ -z "$state_id" ]; then
    log WARN "Could not read the state of $issue_id — leaving it untouched"
  else
    log WARN "$issue_id is no longer In Progress — leaving its state untouched"
  fi
}

# ─── Move issue to a state, clearing the assignee ────────────────────────────
# Shared by move_to_backlog, the gated-success path, and force-shutdown drain.
# Clearing the assignee is essential: /auto-implement assigns the issue to the
# API user, and select_next_issue skips any assigned issue forever.

move_issue_unassigned() {
  local issue_uuid="$1" issue_id="$2" state_id="$3" state_label="$4"
  local vars
  vars=$(jq -n --arg id "$issue_uuid" --arg state "$state_id" '{id: $id, stateId: $state}')
  linear_api \
    'mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId, assigneeId: null }) { success }
    }' "$vars" > /dev/null 2>&1 || log WARN "Failed to move $issue_id to $state_label"
}

# ─── Label management (best-effort) ─────────────────────────────────────────

try_add_label() {
  local issue_uuid="$1" label_name="$2"

  # Find existing label
  local label_id
  label_id=$(linear_api '{
    issueLabels(
      filter: { name: { eq: "'"$label_name"'" }, team: { key: { eq: "HON" } } }
      first: 1
    ) { nodes { id } }
  }' 2>/dev/null | jq -r '.data.issueLabels.nodes[0].id // empty') || return 0

  # Create if not found
  if [ -z "$label_id" ] && [ -n "$TEAM_UUID" ]; then
    local color="#e5484d"
    [ "$label_name" = "Needs attention" ] && color="#f76b15"
    # Stranded is not a failure — the work is sound and the PR is open, it just
    # needs a human to finish it. A distinct colour keeps it out of the red band.
    [ "$label_name" = "Stranded" ] && color="#bb87fc"
    local vars
    vars=$(jq -n --arg name "$label_name" --arg team "$TEAM_UUID" --arg color "$color" \
      '{name: $name, teamId: $team, color: $color}')
    label_id=$(linear_api \
      'mutation($name: String!, $teamId: String!, $color: String!) {
        issueLabelCreate(input: { name: $name, teamId: $teamId, color: $color }) {
          issueLabel { id }
        }
      }' "$vars" 2>/dev/null | jq -r '.data.issueLabelCreate.issueLabel.id // empty') || return 0
  fi

  [ -z "$label_id" ] && return 0

  # Get current labels and append new one
  local label_ids
  label_ids=$(linear_api '{
    issue(id: "'"$issue_uuid"'") { labels { nodes { id } } }
  }' 2>/dev/null | jq --arg new "$label_id" \
    '[.data.issue.labels.nodes[].id, $new] | unique') || return 0

  local vars
  vars=$(jq -n --arg id "$issue_uuid" --argjson labels "$label_ids" '{id: $id, labelIds: $labels}')
  linear_api \
    'mutation($id: String!, $labelIds: [String!]!) {
      issueUpdate(id: $id, input: { labelIds: $labelIds }) { success }
    }' "$vars" > /dev/null 2>&1 || true
}

fetch_team_uuid() {
  local response
  response=$(linear_api '{ teams(filter: { key: { eq: "HON" } }) { nodes { id } } }') || return 0
  TEAM_UUID=$(echo "$response" | jq -r '.data.teams.nodes[0].id // empty')
  [ -n "$TEAM_UUID" ] && log DEBUG "Team UUID: $TEAM_UUID"
}

# ─── Worktree cleanup (non-interactive) ─────────────────────────────────────

cleanup_worker_worktree() {
  local branch="$1"
  # keep_branch=true removes only the worktree, preserving the local git branch
  # and its paired Neon branch. RETRY needs this: a respawn must reuse a branch
  # that may already have commits pushed and a PR open, so deleting it would
  # discard that work and block the resume.
  local keep_branch="${2:-false}"
  [ -z "$branch" ] && return 0

  local worktree_path
  worktree_path=$(get_worktree_path "$branch")

  if [ ! -d "$worktree_path" ]; then
    log DEBUG "Worktree not found at $worktree_path, skipping cleanup"
    return 0
  fi

  sync_permissions "$worktree_path"
  if git -C "$REPO_ROOT" worktree remove "$worktree_path" --force 2>/dev/null; then
    # Delete the paired Neon branch. Delegates to worktree-claude.sh so all
    # Neon logic (name mapping, protected-name guardrail, "not configured"
    # short-circuit) stays in one place. `|| true` in case the helper errors;
    # a failed Neon delete should never block worker cleanup.
    [ "$keep_branch" = false ] && \
      "$SCRIPT_DIR/worktree-claude.sh" neon-delete "$branch" >/dev/null 2>&1 || true
  else
    log WARN "Failed to remove worktree at $worktree_path — keeping Neon branch"
  fi
  [ "$keep_branch" = false ] && git -C "$REPO_ROOT" branch -D "$branch" 2>/dev/null || true
  git -C "$REPO_ROOT" worktree prune 2>/dev/null || true
  log DEBUG "Cleaned up worktree: $branch"
}

# Replicated from worktree-claude.sh for self-containment
get_worktree_path() {
  local branch="$1"
  local actual_path
  actual_path=$(git -C "$REPO_ROOT" worktree list | grep -F "[$branch]" | awk '{print $1}') || true
  if [ -n "$actual_path" ] && [[ "$actual_path" == "$WORKTREE_BASE"* ]]; then
    echo "$actual_path"
    return
  fi
  local normalized
  normalized=$(echo "$branch" | tr '/' '-')
  echo "$WORKTREE_BASE/$normalized"
}

sync_permissions() {
  local worktree_path="$1"
  local wt_settings="$worktree_path/.claude/settings.local.json"
  local main_settings="$REPO_ROOT/.claude/settings.local.json"

  [ ! -f "$wt_settings" ] && return 0
  [ ! -f "$main_settings" ] && return 0
  command -v jq &> /dev/null || return 0

  local wt_perms main_perms new_perms new_count
  wt_perms=$(jq -r '.permissions.allow // []' "$wt_settings" 2>/dev/null) || return 0
  main_perms=$(jq -r '.permissions.allow // []' "$main_settings" 2>/dev/null) || return 0
  new_perms=$(jq -n --argjson wt "$wt_perms" --argjson main "$main_perms" '$wt - $main')
  new_count=$(echo "$new_perms" | jq 'length')

  if [ "$new_count" -gt 0 ]; then
    log DEBUG "Syncing $new_count permission(s) from worktree"
    jq --argjson new "$new_perms" '.permissions.allow += $new | .permissions.allow |= unique' \
      "$main_settings" > "$main_settings.tmp" && mv "$main_settings.tmp" "$main_settings"
  fi
}

# ─── Shutdown ────────────────────────────────────────────────────────────────

# Force shutdown kills workers mid-flight. Return each in-flight issue to Todo
# and clear the assignee so a future run can pick it up — otherwise it stays In
# Progress and assigned, which select_next_issue skips forever.
drain_workers_to_todo() {
  local i=0
  while [ $i -lt ${#WORKER_PIDS[@]} ]; do
    kill_process_tree "${WORKER_PIDS[$i]}"
    # SIGTERM returns immediately; removing the worktree under a still-live
    # claude/pnpm tree lets it re-create the directory. Wait for the exit
    # (bounded), then escalate to SIGKILL.
    wait_for_exit "${WORKER_PIDS[$i]}" 20 || kill_process_tree "${WORKER_PIDS[$i]}" KILL
    # Remove the worktree but keep the git branch and its Neon branch (same
    # contract as RETRY). A leftover worktree directory would make the next
    # run's `wt auto` exit 1 with "Worktree already exists" instead of
    # resuming the branch.
    cleanup_worker_worktree "${WORKER_BRANCHES[$i]}" true
    if [ "$DRY_RUN" = false ]; then
      restore_todo_if_in_progress "${WORKER_ISSUE_UUIDS[$i]}" "${WORKER_ISSUES[$i]}"
    fi
    i=$((i + 1))
  done
}

shutdown() {
  if [ "$FORCE_SHUTDOWN" = true ]; then
    log WARN "Force shutdown — killing all workers"
    drain_workers_to_todo
    exit 1
  fi

  if [ "$SHUTTING_DOWN" = true ]; then
    FORCE_SHUTDOWN=true
    log WARN "Second signal — force killing workers"
    drain_workers_to_todo
    exit 1
  fi

  SHUTTING_DOWN=true
  log INFO "Shutting down — waiting for ${#WORKER_PIDS[@]} worker(s)"
  log INFO "Send signal again to force kill"

  while [ ${#WORKER_PIDS[@]} -gt 0 ]; do
    monitor_workers
    write_status_file
    sleep 5
  done

  log INFO "All workers finished, exiting"
  exit 0
}

trap shutdown SIGINT SIGTERM

# Bash will not run a trap while it is waiting on a FOREGROUND command: a
# SIGTERM arriving during `sleep "$POLL_INTERVAL"` sits pending until the sleep
# ends, up to 60s later. `wt stop` only allows 15s before it escalates, so the
# orchestrator routinely had not even begun shutting down by the time the second
# signal was sent. Backgrounding the sleep and `wait`-ing on it makes the trap
# fire within a second, because `wait` IS interruptible (HON-572).
#
# KNOWN RESIDUAL — the force escalation is still not delivered. Bash also
# refuses to re-enter a trap handler for a signal whose handler is already
# running, so the second SIGTERM `cmd_stop` sends while shutdown()'s graceful
# wait loop is executing is dropped. FORCE_SHUTDOWN is never set,
# drain_workers_to_todo never runs, and cmd_stop eventually SIGKILLs. Fixing it
# means restructuring shutdown() to only set flags and letting the main loop
# perform the drain; that changes shutdown semantics for both Ctrl-C and
# `wt stop`, so it is deliberately NOT done here — HON-572's execution
# constraints forbid the live orchestrator run that would validate it. HON-575
# owns the live `wt stop` verification and this reproduction.
interruptible_sleep() {
  local pid
  sleep "$1" &
  pid=$!
  wait "$pid" 2>/dev/null || true
}

# ─── Disk space check ───────────────────────────────────────────────────────

check_disk_space() {
  local free_kb
  free_kb=$(df -Pk "$REPO_ROOT" | tail -1 | awk '{print $4}') || return 0
  local free_gb=$((free_kb / 1024 / 1024))
  if [ "$free_gb" -lt 1 ]; then
    log WARN "Low disk space: ${free_gb}GB free (< 1GB threshold)"
    return 1
  fi
  return 0
}

# ─── Validate environment ───────────────────────────────────────────────────

validate_environment() {
  local errors=0

  if [ -z "${LINEAR_API_KEY:-}" ]; then
    log ERROR "LINEAR_API_KEY not set"
    errors=$((errors + 1))
  elif [[ ! "$LINEAR_API_KEY" =~ ^lin_api_ ]]; then
    log WARN "LINEAR_API_KEY doesn't start with 'lin_api_' — may be invalid"
  fi

  for tool in curl jq git; do
    if ! command -v "$tool" &> /dev/null; then
      log ERROR "Required tool not found: $tool"
      errors=$((errors + 1))
    fi
  done

  if ! command -v claude &> /dev/null; then
    log WARN "Claude CLI not found — failure triage will use defaults"
  fi

  # Not fatal: without gh, handle_success cannot confirm a PR's state, so a
  # non-"done" exit is classified STRANDED (the conservative answer) instead of
  # being checked. Outcomes stay honest, they just lose their PR/CI detail.
  if ! command -v gh &> /dev/null; then
    log WARN "gh CLI not found — stranded runs will be reported without PR/CI detail"
  fi

  if [ ! -x "$SCRIPT_DIR/worktree-claude.sh" ]; then
    log ERROR "worktree-claude.sh not found or not executable"
    errors=$((errors + 1))
  fi

  # Test Linear connectivity
  if [ -n "${LINEAR_API_KEY:-}" ]; then
    local test_response
    test_response=$(linear_api '{ viewer { id name } }' 2>/dev/null) || {
      log ERROR "Cannot connect to Linear API"
      errors=$((errors + 1))
    }
    if [ -n "${test_response:-}" ]; then
      local viewer
      viewer=$(echo "$test_response" | jq -r '.data.viewer.name // empty' 2>/dev/null)
      [ -n "$viewer" ] && log INFO "Connected to Linear as: $viewer"
    fi
  fi

  check_disk_space || errors=$((errors + 1))

  if [ "$errors" -gt 0 ]; then
    log ERROR "Environment validation failed ($errors error(s))"
    exit 1
  fi
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  acquire_lock
  trap 'cleanup_status_file; release_lock; rm -f "$SEEN_SKIPS_FILE"' EXIT

  log INFO "═══ Orchestrator starting ═══"

  validate_environment
  fetch_team_uuid

  ORCHESTRATOR_START_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  write_status_file

  log INFO "Config: max_workers=$MAX_WORKERS poll=${POLL_INTERVAL}s timeout=${WORKER_TIMEOUT}s dry_run=$DRY_RUN once=$RUN_ONCE"

  while true; do
    [ "$SHUTTING_DOWN" = true ] && break

    # Monitor running workers
    if [ ${#WORKER_PIDS[@]} -gt 0 ]; then
      monitor_workers
      report_worker_status
    fi

    write_status_file

    # Spawn new worker if slots available
    local active=${#WORKER_PIDS[@]}

    if [ "$active" -lt "$MAX_WORKERS" ] && [ "$SHUTTING_DOWN" = false ]; then
      # Circuit breaker: pause spawning after consecutive failures
      if [ "$PAUSED_UNTIL" -gt 0 ]; then
        local now
        now=$(date +%s)
        if [ "$now" -lt "$PAUSED_UNTIL" ]; then
          local remaining=$(( PAUSED_UNTIL - now ))
          log DEBUG "Circuit breaker active, ${remaining}s remaining"
        else
          log INFO "Circuit breaker reset, resuming"
          PAUSED_UNTIL=0
          CONSECUTIVE_FAILURES=0
          # Fall through to polling below
        fi
      fi

      # In --once mode, only spawn once
      if [ "$PAUSED_UNTIL" -gt 0 ]; then
        : # Circuit breaker still active
      elif [ "$RUN_ONCE" = true ] && [ "$ONCE_SPAWNED" = true ]; then
        : # Already spawned in --once mode
      elif check_disk_space; then
        log DEBUG "Polling: $active/$MAX_WORKERS workers active"

        local response=""
        response=$(fetch_todo_issues 2>/dev/null) || {
          log WARN "Failed to fetch issues from Linear"
          response=""
        }

        if [ -n "$response" ]; then
          local candidate
          candidate=$(select_next_issue "$response") || true

          if [ -n "$candidate" ]; then
            local issue_uuid issue_id branch title
            issue_uuid=$(printf '%s' "$candidate" | cut -f1)
            issue_id=$(printf '%s' "$candidate" | cut -f2)
            branch=$(printf '%s' "$candidate" | cut -f3)
            title=$(printf '%s' "$candidate" | cut -f4-)

            log INFO "Selected: $issue_id — $title"

            if claim_issue "$issue_uuid" "$issue_id"; then
              spawn_worker "$issue_uuid" "$issue_id" "$branch" "$title"
              ONCE_SPAWNED=true
            else
              log WARN "Failed to claim $issue_id, skipping"
            fi
          else
            log DEBUG "No eligible issues found"
          fi
        fi
      else
        log WARN "Pausing: low disk space"
      fi
    fi

    # --once mode: exit when no workers remain
    if [ "$RUN_ONCE" = true ] && [ ${#WORKER_PIDS[@]} -eq 0 ] && [ "$ONCE_SPAWNED" = true ]; then
      log INFO "Single cycle complete (--once)"
      break
    fi
    # --once mode with no issues found
    if [ "$RUN_ONCE" = true ] && [ ${#WORKER_PIDS[@]} -eq 0 ] && [ "$ONCE_SPAWNED" = false ]; then
      log INFO "No issues to process (--once)"
      break
    fi

    # Sleep between polls
    if [ "$RUN_ONCE" = true ] && [ ${#WORKER_PIDS[@]} -gt 0 ]; then
      interruptible_sleep 10  # Poll frequently while waiting for worker
    elif [ "$SHUTTING_DOWN" = false ]; then
      interruptible_sleep "$POLL_INTERVAL"
    fi
  done

  log INFO "═══ Orchestrator stopped ═══"

  # In --once mode, exit with distinct code
  if [ "$RUN_ONCE" = true ]; then
    exit "$ONCE_EXIT_CODE"
  fi
}

# Only run the loop when executed, not when sourced. scripts/orchestrator.test.ts
# sources this file to drive handle_success directly with stubbed collaborators;
# without the guard, sourcing would acquire the instance lock and start polling
# Linear for real.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main
fi

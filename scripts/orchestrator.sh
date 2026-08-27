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
  local line kind level id reason
  while IFS= read -r line; do
    kind="${line%%$'\t'*}"
    case "$kind" in
      SKIP)
        IFS=$'\t' read -r kind level id reason <<< "$line"
        log "$level" "[SKIP] $id $reason"
        ;;
      PICK)
        printf '%s\n' "${line#PICK$'\t'}"
        ;;
    esac
  done < <(echo "$response" | jq -r \
    --arg running "$running" \
    --arg done "$STATE_DONE" \
    --arg canceled "$STATE_CANCELED" \
    --arg duplicate "$STATE_DUPLICATE" \
    --arg viewer "${LINEAR_VIEWER_ID:-}" '
    # A blocker only clears when Done or Canceled. Duplicate never clears on
    # its own (a human must follow duplicateOf or fix the relation) — this
    # mirrors the /auto-implement, /implement-issue and /next-issue gates.
    [$done, $canceled] as $terminal |
    (if $running == "" then [] else ($running | split(",")) end) as $running_list |

    .data.issues.nodes
    | map(. + {
        _running: (.identifier as $id | ($running_list | index($id)) != null),
        # Issues assigned to someone ELSE belong to them — same rule as
        # /next-issue and /auto-implement 1.2. Issues assigned to this user
        # stay pickable: /auto-implement 2.2 assigns "me" and move_to_backlog
        # never clears it, so a blanket assignee != null would strand every
        # issue that has been run once.
        _assigned: (.assignee != null and .assignee.id != $viewer),
        _open_blockers: ([
          .inverseRelations.nodes[]
          | select(.type == "blocks")
          | .issue
          | select(.state.id as $s | ($terminal | index($s)) == null)
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
          elif ._assigned then ["INFO", "assigned to someone else"]
          elif (._blockers_in_worker | length) > 0 then
            ["DEBUG", "blocker " + (._blockers_in_worker | join(", ")) + " is being worked on"]
          elif (._open_blockers | length) > 0 then
            ["INFO",
             "blocked by " + (._open_blockers | map(.identifier + " (" + .state.name + ")") | join(", "))
             + (if any(._open_blockers[]; .state.id == $duplicate)
                then " — a Duplicate blocker never clears on its own; follow its duplicateOf or fix the relation"
                else "" end)]
          else null end)
      })
    # One SKIP line per rejected candidate
    | (.[] | select(._skip != null) | ["SKIP", ._skip[0], .identifier, ._skip[1]] | @tsv),
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
        log INFO "Worker $issue_id (PID $pid) completed successfully"
        handle_success "$issue_id" "$branch" "$log_file"
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

    printf "  ${BLUE}%-8s${NC} %3dm%02ds  %s\n" "$issue_id" "$mins" "$secs" "$status" >&2
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
  local pid="$1"
  local children
  children=$(pgrep -P "$pid" 2>/dev/null) || true
  for child in $children; do
    kill_process_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
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
      # Check if branch has been pushed (upstream tracking = PR stage)
      if git -C "$wt_path" rev-parse --abbrev-ref '@{upstream}' &>/dev/null; then
        echo "pr-review"; return
      fi

      # Check commits ahead of main
      local ahead=0
      ahead=$(git -C "$wt_path" rev-list --count main..HEAD 2>/dev/null) || true
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

handle_success() {
  local issue_id="$1" branch="$2" log_file="$3"

  # Reset circuit breaker on success
  CONSECUTIVE_FAILURES=0
  PAUSED_UNTIL=0

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

  log INFO "[OUTCOME] $issue_id SUCCESS ${duration_str} ${commits}-commits phase=$phase"
  notify "Honkadori" "$issue_id completed ($commits commits, $duration_str)"

  # Track success for --once exit code
  [ "$RUN_ONCE" = true ] && ONCE_EXIT_CODE=0

  log INFO "Cleaning up worktree for $issue_id"
  cleanup_worker_worktree "$branch"
  log INFO "Worker $issue_id complete — worktree cleaned up"
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
      # Use awk with ENVIRON to avoid backslash escape interpretation from -v
      result=$(printf '%s' "$result" | VALUE="$value" awk 'BEGIN{s=ENVIRON["VALUE"]; r="[REDACTED]"} {gsub(s,r)}1')
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

  # Track consecutive failures for circuit breaker
  if [ "$triage" != "RETRY" ]; then
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    if [ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]; then
      local pause_duration=600  # 10 minutes
      PAUSED_UNTIL=$(( $(date +%s) + pause_duration ))
      log WARN "Circuit breaker: $CONSECUTIVE_FAILURES consecutive failures, pausing new workers for ${pause_duration}s"
    fi
  else
    CONSECUTIVE_FAILURES=0
  fi

  case "$triage" in
    RETRY)
      if [ "$retried" = "0" ] && [ "$SHUTTING_DOWN" = false ]; then
        log INFO "Retrying $issue_id: $title"
        cleanup_worker_worktree "$branch"
        # Preserve original title on retry (from WORKER_TITLES array)
        spawn_worker "$issue_uuid" "$issue_id" "$branch" "$original_title" "1"
      else
        log WARN "$issue_id already retried, moving to Backlog"
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

  # Move to Backlog
  vars=$(jq -n --arg id "$issue_uuid" --arg state "$STATE_BACKLOG" '{id: $id, stateId: $state}')
  linear_api \
    'mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) { success }
    }' "$vars" > /dev/null 2>&1 || log WARN "Failed to move $issue_id to Backlog"

  log INFO "Moved $issue_id to Backlog with '$label_name' label"
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
    "$SCRIPT_DIR/worktree-claude.sh" neon-delete "$branch" >/dev/null 2>&1 || true
  else
    log WARN "Failed to remove worktree at $worktree_path — keeping Neon branch"
  fi
  git -C "$REPO_ROOT" branch -D "$branch" 2>/dev/null || true
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

shutdown() {
  if [ "$FORCE_SHUTDOWN" = true ]; then
    log WARN "Force shutdown — killing all workers"
    for pid in ${WORKER_PIDS[@]+"${WORKER_PIDS[@]}"}; do
      kill_process_tree "$pid"
    done
    exit 1
  fi

  if [ "$SHUTTING_DOWN" = true ]; then
    FORCE_SHUTDOWN=true
    log WARN "Second signal — force killing workers"
    for pid in ${WORKER_PIDS[@]+"${WORKER_PIDS[@]}"}; do
      kill_process_tree "$pid"
    done
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
      # Global: select_next_issue needs the viewer id so issues assigned to
      # this user (by a previous /auto-implement 2.2 claim) are still pickable.
      LINEAR_VIEWER_ID=$(echo "$test_response" | jq -r '.data.viewer.id // empty' 2>/dev/null)
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
  trap 'cleanup_status_file; release_lock' EXIT

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
      sleep 10  # Poll frequently while waiting for worker
    elif [ "$SHUTTING_DOWN" = false ]; then
      sleep "$POLL_INTERVAL"
    fi
  done

  log INFO "═══ Orchestrator stopped ═══"

  # In --once mode, exit with distinct code
  if [ "$RUN_ONCE" = true ]; then
    exit "$ONCE_EXIT_CODE"
  fi
}

main

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
REPO_NAME="honkadori"
WORKTREE_BASE="$HOME/.worktrees/$REPO_NAME"
LOG_DIR="$WORKTREE_BASE/logs"
LINEAR_API_URL="https://api.linear.app/graphql"

# Linear workflow state IDs (Honkadori workspace)
STATE_BACKLOG="035a5cef-88de-4334-98a0-b908f61d26a7"
STATE_TODO="bcd0f639-33dd-4da8-a081-4d409c0fe5b4"
STATE_IN_PROGRESS="efa0cbda-898d-440d-a6a9-36e798d00881"
STATE_DONE="5b47cab2-e519-4532-8aa2-f4926e16bcd7"
STATE_CANCELED="20dedb1c-9cb4-4db4-8a3a-c2eb39fbd616"
STATE_DUPLICATE="d173c772-7085-46c9-bece-6a8a74d0ae27"

# ─── Worker tracking (parallel arrays, bash 3.2 compatible) ──────────────────

WORKER_PIDS=()
WORKER_ISSUES=()
WORKER_ISSUE_UUIDS=()
WORKER_BRANCHES=()
WORKER_LOGS=()
WORKER_START_TIMES=()
WORKER_RETRIED=()

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
TEAM_UUID=""

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

select_next_issue() {
  local response="$1"

  # Build comma-separated list of running worker issue IDs
  local running=""
  for issue in ${WORKER_ISSUES[@]+"${WORKER_ISSUES[@]}"}; do
    running="${running:+$running,}$issue"
  done

  echo "$response" | jq -r \
    --arg running "$running" \
    --arg done "$STATE_DONE" \
    --arg canceled "$STATE_CANCELED" \
    --arg duplicate "$STATE_DUPLICATE" '
    [$done, $canceled, $duplicate] as $terminal |
    (if $running == "" then [] else ($running | split(",")) end) as $running_list |

    .data.issues.nodes
    # Exclude issues already being worked on
    | map(select(.identifier as $id | ($running_list | index($id)) | not))
    # Compute blocking info
    | map(. + {
        _blocked: ([
          .inverseRelations.nodes[]
          | select(.type == "blocks")
          | .issue.state.id
          | select(. as $s | $terminal | index($s) | not)
        ] | length > 0),
        _blocker_in_worker: ([
          .inverseRelations.nodes[]
          | select(.type == "blocks")
          | .issue.identifier
          | select(. as $bid | $running_list | index($bid))
        ] | length > 0),
        _blocks_count: ([
          .relations.nodes[] | select(.type == "blocks")
        ] | length)
      })
    # Keep unblocked issues without blockers being processed
    | map(select(._blocked | not))
    | map(select(._blocker_in_worker | not))
    # Sort: blocks others first (desc), then priority (asc, 0=no priority→5)
    | sort_by([(._blocks_count * -1), (if .priority == 0 then 5 else .priority end)])
    | if length > 0 then .[0] | [.id, .identifier, (.branchName // ""), .title] | @tsv
      else empty end
  '
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

  log INFO "Worker started (PID $pid)"
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

    if kill -0 "$pid" 2>/dev/null; then
      # Still running — check timeout
      local now elapsed
      now=$(date +%s)
      elapsed=$((now - start_time))

      if [ "$elapsed" -ge "$WORKER_TIMEOUT" ]; then
        log WARN "Worker $issue_id (PID $pid) timed out after ${elapsed}s"
        kill_process_tree "$pid"
        sleep 2
        handle_failure "$issue_id" "$issue_uuid" "$branch" "$log_file" "$retried" "timeout"
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
        handle_failure "$issue_id" "$issue_uuid" "$branch" "$log_file" "$retried" "exit:$exit_code"
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

remove_worker() {
  local idx="$1"
  local new_pids=() new_issues=() new_uuids=() new_branches=()
  local new_logs=() new_starts=() new_retried=()

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
  else
    WORKER_PIDS=()
    WORKER_ISSUES=()
    WORKER_ISSUE_UUIDS=()
    WORKER_BRANCHES=()
    WORKER_LOGS=()
    WORKER_START_TIMES=()
    WORKER_RETRIED=()
  fi
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

# ─── Handle success ─────────────────────────────────────────────────────────

handle_success() {
  local issue_id="$1" branch="$2" log_file="$3"

  log INFO "Cleaning up worktree for $issue_id"
  cleanup_worker_worktree "$branch"
  log INFO "Worker $issue_id complete — worktree cleaned up"
}

# ─── Handle failure ─────────────────────────────────────────────────────────

handle_failure() {
  local issue_id="$1" issue_uuid="$2" branch="$3" log_file="$4"
  local retried="$5" failure_type="$6"

  log WARN "Triaging failure for $issue_id ($failure_type)"

  # Get log tail for triage
  local log_tail="(no log)"
  if [ -f "$log_file" ]; then
    log_tail=$(tail -200 "$log_file" 2>/dev/null || echo "(log not readable)")
  fi

  # Claude-powered triage (default to BACKLOG if unavailable)
  local triage="BACKLOG"
  if command -v claude &> /dev/null && [ "$DRY_RUN" = false ]; then
    local triage_result
    triage_result=$(echo "$log_tail" | claude -p "Worker for $issue_id failed ($failure_type). Based on the log from stdin, respond with EXACTLY one word:
RETRY - transient failure (flaky test, network error, rate limit, timeout)
BACKLOG - issue needs refinement (bad description, missing context, wrong approach)
NEEDS_HUMAN - infrastructure problem (disk space, auth expired, config broken)" 2>/dev/null | tr -d '[:space:]') || true

    case "$triage_result" in
      RETRY|BACKLOG|NEEDS_HUMAN) triage="$triage_result" ;;
      *) log WARN "Unexpected triage result: '$triage_result', defaulting to BACKLOG" ;;
    esac
  fi

  log INFO "Triage for $issue_id: $triage"

  case "$triage" in
    RETRY)
      if [ "$retried" = "0" ] && [ "$SHUTTING_DOWN" = false ]; then
        log INFO "Retrying $issue_id"
        cleanup_worker_worktree "$branch"
        spawn_worker "$issue_uuid" "$issue_id" "$branch" "(retry)" "1"
      else
        log WARN "$issue_id already retried, moving to Backlog"
        move_to_backlog "$issue_uuid" "$issue_id" "$log_tail" "failed" \
          "Auto-implementation failed after retry ($failure_type)"
        cleanup_worker_worktree "$branch"
      fi ;;
    BACKLOG)
      move_to_backlog "$issue_uuid" "$issue_id" "$log_tail" "failed" \
        "Auto-implementation failed ($failure_type)"
      cleanup_worker_worktree "$branch" ;;
    NEEDS_HUMAN)
      move_to_backlog "$issue_uuid" "$issue_id" "$log_tail" "needs-attention" \
        "Auto-implementation needs human attention ($failure_type)"
      cleanup_worker_worktree "$branch" ;;
  esac
}

# ─── Move issue to Backlog with comment + label ─────────────────────────────

move_to_backlog() {
  local issue_uuid="$1" issue_id="$2" log_tail="$3"
  local label_name="$4" summary="$5"

  # Add failure comment
  local body
  body=$(printf '## Auto-implementation failed\n\n**%s**\n\n<details>\n<summary>Log tail (last 200 lines)</summary>\n\n```\n%s\n```\n\n</details>' \
    "$summary" "$(echo "$log_tail" | head -200)")

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
    [ "$label_name" = "needs-attention" ] && color="#f76b15"
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
  git -C "$REPO_ROOT" worktree remove "$worktree_path" --force 2>/dev/null || \
    log WARN "Failed to remove worktree at $worktree_path"
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
    sleep 5
  done

  log INFO "All workers finished, exiting"
  exit 0
}

trap shutdown SIGINT SIGTERM

# ─── Disk space check ───────────────────────────────────────────────────────

check_disk_space() {
  local free_kb
  free_kb=$(df -k "$REPO_ROOT" | tail -1 | awk '{print $4}') || return 0
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
  log INFO "═══ Orchestrator starting ═══"

  validate_environment
  fetch_team_uuid

  log INFO "Config: max_workers=$MAX_WORKERS poll=${POLL_INTERVAL}s timeout=${WORKER_TIMEOUT}s dry_run=$DRY_RUN once=$RUN_ONCE"

  while true; do
    [ "$SHUTTING_DOWN" = true ] && break

    # Monitor running workers
    if [ ${#WORKER_PIDS[@]} -gt 0 ]; then
      monitor_workers
    fi

    # Spawn new worker if slots available
    local active=${#WORKER_PIDS[@]}

    if [ "$active" -lt "$MAX_WORKERS" ] && [ "$SHUTTING_DOWN" = false ]; then
      # In --once mode, only spawn once
      if [ "$RUN_ONCE" = true ] && [ "$ONCE_SPAWNED" = true ]; then
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
}

main

#!/bin/bash
# Parallel Claude Code Worktree Manager
#
# Manages git worktrees for running multiple Claude Code instances in parallel.
# Each worktree is isolated, allowing concurrent work on different features.
#
# Usage:
#   ./scripts/worktree-claude.sh new <branch-name>      # Create new worktree + start Claude
#   ./scripts/worktree-claude.sh auto [issue-id|branch] # Create worktree + run /auto-implement autonomously
#   ./scripts/worktree-claude.sh resume <branch-name>   # Resume existing worktree
#   ./scripts/worktree-claude.sh list                   # List all worktrees
#   ./scripts/worktree-claude.sh status                 # Show orchestrator and worker status
#   ./scripts/worktree-claude.sh sync <branch-name>     # Sync permissions to main repo
#   ./scripts/worktree-claude.sh sync-all               # Sync permissions from all worktrees
#   ./scripts/worktree-claude.sh cleanup <branch-name>  # Remove worktree (auto-syncs)
#   ./scripts/worktree-claude.sh cleanup-all            # Remove all parallel worktrees (auto-syncs)
#
# Worktrees are created in ~/.worktrees/wobblepot/<branch-name>

set -e

# Configuration
REPO_NAME="wobblepot"
WORKTREE_BASE="$HOME/.worktrees/$REPO_NAME"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Untracked files to copy to worktrees
# Format: "source_path:needs_path_update"
# - source_path: path relative to repo root
# - needs_path_update: "true" if PROJECT_ROOT should be updated to worktree path
UNTRACKED_FILES=(
  ".env:true"
  ".claude/settings.local.json:true"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Get the main (non-worktree) repository path
get_main_repo_path() {
  # The main worktree is the first line in git worktree list (not in WORKTREE_BASE)
  git worktree list | head -1 | awk '{print $1}'
}

# Sync permissions from worktree back to main repo
sync_permissions() {
  local worktree_path="$1"
  local worktree_settings="$worktree_path/.claude/settings.local.json"
  local main_repo_path=$(get_main_repo_path)
  local main_settings="$main_repo_path/.claude/settings.local.json"

  # Skip if syncing main repo to itself
  if [ "$worktree_path" = "$main_repo_path" ]; then
    return 0
  fi

  # Skip if either file doesn't exist
  if [ ! -f "$worktree_settings" ] || [ ! -f "$main_settings" ]; then
    return 0
  fi

  # Check for jq
  if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}Warning: jq not found, skipping permission sync${NC}"
    return 0
  fi

  # Get permissions from both files
  local worktree_perms=$(jq -r '.permissions.allow // []' "$worktree_settings" 2>/dev/null)
  local main_perms=$(jq -r '.permissions.allow // []' "$main_settings" 2>/dev/null)

  # Find new permissions (in worktree but not in main)
  local new_perms=$(jq -n --argjson wt "$worktree_perms" --argjson main "$main_perms" \
    '$wt - $main')

  local new_count=$(echo "$new_perms" | jq 'length')

  if [ "$new_count" -gt 0 ]; then
    echo -e "${BLUE}Syncing $new_count new permission(s) to main repo...${NC}"
    echo "$new_perms" | jq -r '.[]' | while read -r perm; do
      echo "  + $perm"
    done

    # Merge new permissions into main settings
    jq --argjson new "$new_perms" '.permissions.allow += $new | .permissions.allow |= unique' \
      "$main_settings" > "$main_settings.tmp" && mv "$main_settings.tmp" "$main_settings"

    echo -e "${GREEN}Permissions synced to $main_settings${NC}"
  fi
}

# ─── Neon database branching ──────────────────────────────────────────────────
#
# Each worktree can be paired with its own Neon branch (isolated copy-on-write
# database). Opt-in via NEON_API_KEY + NEON_PROJECT_ID env vars. When unset,
# worktrees fall back to the shared DATABASE_URL from .env.
#
# neonctl is invoked via pnpm dlx with a pinned version — no dev dep, no
# global install, reproducible behavior. Bump NEONCTL_VERSION deliberately.
NEONCTL_VERSION="2.22.0"

# Map a git branch name to a Neon branch name (deterministic, reversible).
# `/` becomes `--` rather than `-` so git branches `feat/foo-bar` and
# `feat-foo/bar` don't collide on the same Neon branch name.
# Example: auto/hon-339-foo -> auto--hon-339-foo
neon_branch_name() {
  echo "${1//\//--}"
}

# Hard-refuse list of protected Neon branch names. Defense-in-depth against
# catastrophic deletes (see Neon dashboard's ⛨ marker for server-side backstop).
is_protected_neon_branch() {
  case "$1" in
    staging|main|production|preview) return 0 ;;
    *) return 1 ;;
  esac
}

# Check if Neon integration is configured.
neon_enabled() {
  [ -n "${NEON_API_KEY:-}" ] && [ -n "${NEON_PROJECT_ID:-}" ]
}

# Atomically update (or create) a key in a .env file. Values are double-quoted
# to match .env.example convention. Regex anchors on `^KEY=` so related keys
# (e.g., DATABASE_URL vs DATABASE_URL_UNPOOLED) aren't cross-matched.
update_env_var() {
  local key="$1" value="$2" file="$3"
  local tmp
  tmp=$(mktemp)
  awk -v k="$key" -v v="$value" '
    BEGIN { found = 0 }
    $0 ~ "^"k"=" { print k"=\""v"\""; found = 1; next }
    { print }
    END { if (!found) print k"=\""v"\"" }
  ' "$file" > "$tmp" && mv "$tmp" "$file"
}

# Delete Neon branches whose live git worktree no longer exists. Filters to
# auto-* / kaupo-* prefixes so the GC can't touch hand-managed branches. Skips
# protected names. Safe to call repeatedly; errors from individual deletes
# are ignored (best-effort sweep).
neon_gc_orphans() {
  neon_enabled || return 0
  local live_worktrees
  # Must match neon_branch_name's `/` -> `--` mapping so GC can recognize its
  # own branches. Never bump this in isolation.
  live_worktrees=$(git -C "$REPO_ROOT" worktree list --porcelain \
    | awk '/^branch /{print substr($2, 12)}' | sed 's|/|--|g' | sort -u)

  # Split list + filter into two steps so we can detect API failures. A silent
  # no-op here would mask the real problem (auth, network, rate limit) as a
  # later "cap exceeded" error, which is much harder to diagnose.
  local list_out list_rc
  list_out=$(pnpm dlx "neonctl@$NEONCTL_VERSION" branches list \
    --project-id "$NEON_PROJECT_ID" --output json 2>/dev/null)
  list_rc=$?
  if [ "$list_rc" -ne 0 ]; then
    echo -e "${YELLOW}Warning: Neon branches list failed (exit $list_rc) — skipping orphan GC${NC}" >&2
    return 0
  fi

  # GC reclaims branches with known prefixes: `auto-` (always, from the
  # orchestrator's `wt auto HON-XX` → `auto/hon-XX` → Neon `auto--hon-XX`),
  # plus `${NEON_USER_PREFIX}-` when set (from interactive `wt new <prefix>/...`).
  # Anything else — `feat-`, `fix-`, test scaffolds, hand-managed branches —
  # stays untouched; users clean those up via `wt cleanup`.
  # Shape-tolerant: accepts either `[...]` or `{"branches": [...]}` wire formats.
  # `.branches // .` would throw on a bare array (Cannot index array with string),
  # so dispatch on type first.
  local all_neon_branches
  all_neon_branches=$(echo "$list_out" \
    | jq -r --arg user_prefix "${NEON_USER_PREFIX:-}" '
        if type == "array" then .[]
        elif .branches then .branches[]
        else empty end
        | select(
            (.name | startswith("auto-"))
            or ($user_prefix != "" and (.name | startswith($user_prefix + "-")))
          )
        | .name')
  local b
  while IFS= read -r b; do
    [ -z "$b" ] && continue
    if ! echo "$live_worktrees" | grep -qx "$b"; then
      if is_protected_neon_branch "$b"; then
        continue
      fi
      pnpm dlx "neonctl@$NEONCTL_VERSION" branches delete "$b" \
        --project-id "$NEON_PROJECT_ID" >/dev/null 2>&1 || true
    fi
  done <<< "$all_neon_branches"
}

# Create a Neon branch forked from $NEON_PARENT_BRANCH (default: staging) and
# patch the worktree's .env to point at it. Self-heals orphan cap via GC retry.
# Collisions fail loud — require --fresh-db to recreate.
neon_create_branch_for_worktree() {
  local git_branch="$1" worktree_env="$2" fresh_db="${3:-0}"
  if ! neon_enabled; then
    echo -e "${YELLOW}Neon branching disabled (NEON_API_KEY/NEON_PROJECT_ID not set) — using shared DB${NC}"
    return 0
  fi

  local neon_branch parent
  neon_branch=$(neon_branch_name "$git_branch")
  parent="${NEON_PARENT_BRANCH:-staging}"

  # Symmetrical with the delete guardrail: refuse to create/overwrite a
  # protected name no matter how the git branch was named.
  if is_protected_neon_branch "$neon_branch"; then
    echo -e "${RED}Error: refusing to provision protected Neon branch name '$neon_branch'${NC}" >&2
    return 1
  fi

  # Fresh-DB: nuke any existing branch first.
  if [ "$fresh_db" = "1" ]; then
    pnpm dlx "neonctl@$NEONCTL_VERSION" branches delete "$neon_branch" \
      --project-id "$NEON_PROJECT_ID" >/dev/null 2>&1 || true
  fi

  # Attempt create; on cap error run GC and retry once. The cap-error regex
  # requires "branch" near one of the exhaustion keywords so plain rate-limit
  # responses (which GC can't help with) don't trigger a pointless sweep.
  local create_out
  create_out=$(pnpm dlx "neonctl@$NEONCTL_VERSION" branches create \
    --project-id "$NEON_PROJECT_ID" --name "$neon_branch" --parent "$parent" \
    --output json 2>&1) || {
    if echo "$create_out" | grep -qi "branch" \
       && echo "$create_out" | grep -qiE "limit|quota|cap|exceed|maximum"; then
      echo -e "${YELLOW}Neon branch cap hit — running orphan GC...${NC}"
      neon_gc_orphans
      create_out=$(pnpm dlx "neonctl@$NEONCTL_VERSION" branches create \
        --project-id "$NEON_PROJECT_ID" --name "$neon_branch" --parent "$parent" \
        --output json 2>&1) || {
        echo -e "${RED}Error: Neon branch cap still exceeded after orphan GC.${NC}" >&2
        echo "$create_out" >&2
        return 1
      }
    elif echo "$create_out" | grep -qiE "already exists|duplicate"; then
      echo -e "${RED}Error: Neon branch '$neon_branch' already exists after orphan cleanup.${NC}" >&2
      echo "Run 'wt cleanup $git_branch' or pass --fresh-db to force recreate." >&2
      return 1
    else
      echo -e "${RED}Error: Neon branch create failed:${NC}" >&2
      echo "$create_out" >&2
      return 1
    fi
  }

  local pooled unpooled
  pooled=$(pnpm dlx "neonctl@$NEONCTL_VERSION" connection-string "$neon_branch" \
    --project-id "$NEON_PROJECT_ID" --pooled 2>/dev/null)
  unpooled=$(pnpm dlx "neonctl@$NEONCTL_VERSION" connection-string "$neon_branch" \
    --project-id "$NEON_PROJECT_ID" 2>/dev/null)

  if [ -z "$pooled" ] || [ -z "$unpooled" ]; then
    echo -e "${RED}Error: Neon branch created but could not fetch connection strings.${NC}" >&2
    # Don't leak the branch we just created. Best-effort delete.
    pnpm dlx "neonctl@$NEONCTL_VERSION" branches delete "$neon_branch" \
      --project-id "$NEON_PROJECT_ID" >/dev/null 2>&1 || true
    return 1
  fi

  # Ensure .env exists — if copy_untracked_files skipped it (main repo has no
  # .env) awk would fail under `set -e` *after* the Neon branch was created,
  # leaking a branch. Creating an empty .env here is the cheapest fix.
  [ -f "$worktree_env" ] || touch "$worktree_env"

  update_env_var DATABASE_URL "$pooled" "$worktree_env"
  update_env_var DATABASE_URL_UNPOOLED "$unpooled" "$worktree_env"
  echo -e "${GREEN}Neon branch '$neon_branch' created (forked from '$parent')${NC}"
}

# Delete the Neon branch that corresponds to a git branch. Never fails the
# overall cleanup — Neon API outage shouldn't block worktree removal.
neon_delete_branch_for_worktree() {
  local git_branch="$1"
  neon_enabled || return 0
  local neon_branch
  neon_branch=$(neon_branch_name "$git_branch")
  if is_protected_neon_branch "$neon_branch"; then
    echo -e "${YELLOW}Refusing to delete protected Neon branch '$neon_branch'${NC}" >&2
    return 0
  fi
  if pnpm dlx "neonctl@$NEONCTL_VERSION" branches delete "$neon_branch" \
    --project-id "$NEON_PROJECT_ID" >/dev/null 2>&1; then
    echo -e "${GREEN}Neon branch '$neon_branch' deleted${NC}"
  else
    echo -e "${YELLOW}Neon branch '$neon_branch' not found or already deleted${NC}"
  fi
}

print_usage() {
  echo "Usage: $0 <command> [branch-name|issue-id]"
  echo ""
  echo "Commands:"
  echo "  start [flags]          Start orchestrator in background (flags passed through)"
  echo "  stop                   Stop the running orchestrator"
  echo "  watch [interval]       Live dashboard with status + activity (default: 5s)"
  echo "  status [-v]            Show orchestrator and worker status (-v for details)"
  echo "  logs <issue> [lines]   Show recent Claude activity for a worker (default: 20 messages)"
  echo ""
  echo "  new <branch-name>      Create new worktree and start Claude Code"
  echo "  auto [issue-id|branch] Create worktree and run /auto-implement autonomously"
  echo "  resume <branch-name>   Open Claude Code in existing worktree"
  echo "  list                   List all active worktrees"
  echo "  sync <branch-name>     Sync permissions from worktree to main repo"
  echo "  sync-all               Sync permissions from all worktrees"
  echo "  cleanup <branch-name>  Remove a specific worktree (auto-syncs permissions)"
  echo "  cleanup-all            Remove all parallel worktrees (auto-syncs permissions)"
  echo ""
  echo "Examples:"
  echo "  $0 new feat/api-caching"
  echo "  $0 auto HON-51                        # Issue ID - creates auto/hon-51 branch"
  echo "  $0 auto 51                            # Just number - same as HON-51"
  echo "  $0 auto user/hon-51-feature-name      # Branch name from Linear (preferred)"
  echo "  $0 auto                               # Find next available issue"
  echo "  $0 resume feat/api-caching"
  echo "  $0 cleanup feat/api-caching"
}

# Copy a single untracked file to worktree with optional PROJECT_ROOT substitution
# Args: $1=source_repo, $2=source_path, $3=dest_dir, $4=needs_path_update ("true"/"false")
copy_untracked_file() {
  local source_repo="$1"
  local source_path="$2"
  local dest_dir="$3"
  local needs_path_update="$4"
  local source_file="$source_repo/$source_path"
  local dest_file="$dest_dir/$source_path"

  # Skip if source doesn't exist
  if [ ! -f "$source_file" ]; then
    return 1
  fi

  # Create destination directory if needed
  mkdir -p "$(dirname "$dest_file")"

  if [ "$needs_path_update" = "true" ]; then
    # Update PROJECT_ROOT to point to the worktree path
    # Handles both JSON format ("PROJECT_ROOT": "/path") and env format (PROJECT_ROOT=/path)
    sed -e "s|\"PROJECT_ROOT\": \"$source_repo\"|\"PROJECT_ROOT\": \"$dest_dir\"|g" \
        -e "s|^PROJECT_ROOT=$source_repo$|PROJECT_ROOT=$dest_dir|g" \
        -e "s|^PROJECT_ROOT=\"$source_repo\"$|PROJECT_ROOT=\"$dest_dir\"|g" \
        "$source_file" > "$dest_file"
  else
    cp "$source_file" "$dest_file"
  fi

  return 0
}

# Copy all configured untracked files to worktree
# Args: $1=worktree_path
copy_untracked_files() {
  local worktree_path="$1"
  local main_repo=$(get_main_repo_path)
  local copied=()
  local skipped=()

  for entry in "${UNTRACKED_FILES[@]}"; do
    local source_path="${entry%%:*}"
    local needs_path_update="${entry##*:}"

    if copy_untracked_file "$main_repo" "$source_path" "$worktree_path" "$needs_path_update"; then
      copied+=("$source_path")
    else
      skipped+=("$source_path")
    fi
  done

  # Log results
  if [ ${#copied[@]} -gt 0 ]; then
    echo "Copied untracked files: ${copied[*]}"
  fi

  # Warn specifically about .env since it's critical
  for path in "${skipped[@]}"; do
    if [ "$path" = ".env" ]; then
      echo -e "${YELLOW}Warning: .env not found in main repo - worktree will lack environment variables${NC}"
    fi
  done
}

# Normalize branch name to filesystem-safe path
normalize_branch() {
  echo "$1" | tr '/' '-'
}

# Get worktree path for a branch
# First checks git worktree list for actual path, falls back to derived path
get_worktree_path() {
  local branch="$1"

  # Look up actual path from git worktree list (using -F for literal matching)
  local actual_path=$(git -C "$REPO_ROOT" worktree list | grep -F "[$branch]" | awk '{print $1}')

  if [ -n "$actual_path" ] && [[ "$actual_path" == "$WORKTREE_BASE"* ]]; then
    echo "$actual_path"
    return
  fi

  # Fall back to derived path (for new worktrees)
  local normalized=$(normalize_branch "$branch")
  echo "$WORKTREE_BASE/$normalized"
}

# Check if worktree exists
worktree_exists() {
  local path="$1"
  git -C "$REPO_ROOT" worktree list | grep -q "$path"
}

# Create new worktree
cmd_new() {
  local branch=""
  local fresh_db=0
  local arg
  for arg in "$@"; do
    case "$arg" in
      --fresh-db) fresh_db=1 ;;
      -*)
        echo -e "${RED}Error: Unknown flag: $arg${NC}" >&2
        print_usage
        exit 1 ;;
      *)
        if [ -z "$branch" ]; then
          branch="$arg"
        else
          echo -e "${RED}Error: Unexpected extra argument: $arg${NC}" >&2
          print_usage
          exit 1
        fi ;;
    esac
  done

  if [ -z "$branch" ]; then
    echo -e "${RED}Error: Branch name required${NC}"
    print_usage
    exit 1
  fi

  local worktree_path=$(get_worktree_path "$branch")

  # Check if worktree already exists
  if [ -d "$worktree_path" ]; then
    echo -e "${YELLOW}Worktree already exists at $worktree_path${NC}"
    echo "Use 'resume' to open it, or 'cleanup' to remove it first."
    exit 1
  fi

  # Create worktree directory
  mkdir -p "$WORKTREE_BASE"

  echo -e "${BLUE}Creating worktree for branch: $branch${NC}"
  echo "Location: $worktree_path"
  echo ""

  # Create worktree with new branch from current HEAD
  git -C "$REPO_ROOT" worktree add -b "$branch" "$worktree_path"

  echo ""
  echo -e "${BLUE}Setting up worktree...${NC}"
  echo ""

  cd "$worktree_path"

  # Copy untracked files from main repo (.env, Claude settings, etc.)
  copy_untracked_files "$worktree_path"

  # Install dependencies BEFORE Neon provisioning so a pnpm failure (lockfile
  # conflict, registry 5xx, corrupt node_modules, OOM) can't leak a fresh
  # Neon branch. `db:generate` reads DATABASE_URL from the copied .env but
  # doesn't connect, so the shared URL is fine here.
  echo "Installing dependencies..."
  if command -v pnpm &> /dev/null; then
    pnpm install
    pnpm db:generate
  else
    echo -e "${YELLOW}Warning: pnpm not found, skipping dependency installation${NC}"
  fi

  # Provision a Neon branch and patch DATABASE_URL in the worktree .env.
  # No-op when NEON_API_KEY/NEON_PROJECT_ID are unset.
  neon_create_branch_for_worktree "$branch" "$worktree_path/.env" "$fresh_db" || exit 1

  echo ""
  echo -e "${GREEN}Worktree ready!${NC}"
  echo ""
  echo "Starting Claude Code..."
  echo "─────────────────────────────────────────"
  echo ""

  # Start Claude Code in the worktree
  # Unset ANTHROPIC_API_KEY so Claude CLI uses Max subscription instead of API credits
  exec env -u ANTHROPIC_API_KEY claude
}

# Fully autonomous worktree - creates worktree and runs /auto-implement
cmd_auto() {
  local arg=""
  local fresh_db=0
  local positional_arg=""
  local a
  for a in "$@"; do
    case "$a" in
      --fresh-db) fresh_db=1 ;;
      -*)
        echo -e "${RED}Error: Unknown flag: $a${NC}" >&2
        print_usage
        exit 1 ;;
      *)
        if [ -z "$positional_arg" ]; then
          positional_arg="$a"
        else
          echo -e "${RED}Error: Unexpected extra argument: $a${NC}" >&2
          print_usage
          exit 1
        fi ;;
    esac
  done
  arg="$positional_arg"

  local branch
  local issue_id
  local prompt

  # Parse argument - could be issue ID (HON-XX), branch name, or empty
  if [ -n "$arg" ]; then
    # Check if it looks like a branch name (contains / or starts with user/)
    if [[ "$arg" == *"/"* ]]; then
      # It's a branch name - extract issue ID from it
      branch="$arg"
      # Extract HON-XX pattern from branch name (case insensitive)
      issue_id=$(echo "$arg" | grep -oiE 'hon-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]')
      if [ -z "$issue_id" ]; then
        echo -e "${RED}Error: Could not extract issue ID from branch name: $arg${NC}"
        echo "Branch name should contain 'HON-XX' pattern (e.g., 'user/hon-51-feature-name')"
        exit 1
      fi
      prompt="/auto-implement $issue_id"
    else
      # It's an issue ID - normalize and create auto/ branch
      issue_id=$(echo "$arg" | tr '[:lower:]' '[:upper:]')
      # Add HON- prefix if just a number
      if [[ "$issue_id" =~ ^[0-9]+$ ]]; then
        issue_id="HON-$issue_id"
      fi
      branch="auto/$(echo "$issue_id" | tr '[:upper:]' '[:lower:]')"
      prompt="/auto-implement $issue_id"
    fi
  else
    # No argument - use timestamp for unique branch, let /auto-implement find next issue
    branch="auto/$(date +%Y%m%d-%H%M%S)"
    prompt="/auto-implement"
  fi

  local worktree_path=$(get_worktree_path "$branch")

  # Check if worktree already exists
  if [ -d "$worktree_path" ]; then
    echo -e "${YELLOW}Worktree already exists at $worktree_path${NC}"
    echo "Use 'resume' to open it, or 'cleanup' to remove it first."
    exit 1
  fi

  # Create worktree directory
  mkdir -p "$WORKTREE_BASE"

  echo -e "${BLUE}Creating autonomous worktree for: ${issue_id:-next issue}${NC}"
  echo "Branch: $branch"
  echo "Location: $worktree_path"
  echo ""

  # Pull latest main so the worktree branches from up-to-date code
  echo "Pulling latest main..."
  git -C "$REPO_ROOT" pull origin main --ff-only 2>/dev/null || \
    echo -e "${YELLOW}Warning: Could not fast-forward main (may be on a different branch)${NC}"

  # Create the worktree. When the branch already exists — an orchestrator RETRY
  # that preserved it to resume an open PR — check it out as-is instead of
  # recreating it from main, which would discard its commits.
  if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$branch"; then
    echo "Reusing existing branch: $branch"
    git -C "$REPO_ROOT" worktree add "$worktree_path" "$branch"
  else
    git -C "$REPO_ROOT" worktree add -b "$branch" "$worktree_path"
  fi

  echo ""
  echo -e "${BLUE}Setting up worktree...${NC}"
  echo ""

  cd "$worktree_path"

  # Copy untracked files from main repo (.env, Claude settings, etc.)
  copy_untracked_files "$worktree_path"

  # Install dependencies BEFORE Neon provisioning so a pnpm failure can't
  # leak a fresh Neon branch. db:generate doesn't connect — shared DATABASE_URL
  # from the copied .env is sufficient.
  echo "Installing dependencies..."
  if command -v pnpm &> /dev/null; then
    pnpm install
    pnpm db:generate
  else
    echo -e "${YELLOW}Warning: pnpm not found, skipping dependency installation${NC}"
  fi

  # Provision a Neon branch and patch DATABASE_URL in the worktree .env.
  # No-op when NEON_API_KEY/NEON_PROJECT_ID are unset. Failure is fatal so
  # the orchestrator logs a clean failure and moves on (no silent shared-DB fallback).
  neon_create_branch_for_worktree "$branch" "$worktree_path/.env" "$fresh_db" || exit 1

  echo ""
  echo -e "${GREEN}Worktree ready!${NC}"
  echo ""
  echo "Starting autonomous Claude Code with: $prompt"
  echo "─────────────────────────────────────────"
  echo ""

  # Start Claude Code with permissions bypassed and auto-implement prompt
  # Unset ANTHROPIC_API_KEY so Claude CLI uses Max subscription instead of API credits
  exec env -u ANTHROPIC_API_KEY claude --dangerously-skip-permissions --model "${CLAUDE_AUTO_MODEL:-claude-opus-5}" "$prompt"
}

# Resume existing worktree
cmd_resume() {
  local branch="$1"
  if [ -z "$branch" ]; then
    echo -e "${RED}Error: Branch name required${NC}"
    print_usage
    exit 1
  fi

  local worktree_path=$(get_worktree_path "$branch")

  if [ ! -d "$worktree_path" ]; then
    echo -e "${RED}Error: Worktree not found at $worktree_path${NC}"
    echo "Use 'list' to see available worktrees, or 'new' to create one."
    exit 1
  fi

  echo -e "${BLUE}Resuming worktree: $branch${NC}"
  echo "Location: $worktree_path"
  echo ""

  cd "$worktree_path"
  # Unset ANTHROPIC_API_KEY so Claude CLI uses Max subscription instead of API credits
  exec env -u ANTHROPIC_API_KEY claude --resume
}

# Show orchestrator and worker status
cmd_status() {
  local verbose=false
  if [ "${1:-}" = "-v" ] || [ "${1:-}" = "--verbose" ]; then
    verbose=true
  fi
  local status_file="$WORKTREE_BASE/orchestrator-status.json"

  if [ ! -f "$status_file" ]; then
    echo -e "${YELLOW}No orchestrator status file found.${NC}"
    echo "Start the orchestrator with: ./scripts/orchestrator.sh"
    return
  fi

  local status
  status=$(cat "$status_file" 2>/dev/null) || {
    echo -e "${RED}Error reading status file${NC}"
    return 1
  }

  local orch_pid started_at last_poll max_workers
  orch_pid=$(echo "$status" | jq -r '.pid')
  started_at=$(echo "$status" | jq -r '.started_at')
  last_poll=$(echo "$status" | jq -r '.last_poll')
  max_workers=$(echo "$status" | jq -r '.max_workers')

  # Check if orchestrator process is alive
  local orch_alive=false
  if kill -0 "$orch_pid" 2>/dev/null; then
    orch_alive=true
  fi

  # Calculate uptime and last poll age
  local now
  now=$(date +%s)

  local uptime_str=""
  if [ -n "$started_at" ] && [ "$started_at" != "null" ]; then
    local start_epoch
    start_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$started_at" '+%s' 2>/dev/null) || \
    start_epoch=$(date -d "$started_at" '+%s' 2>/dev/null) || start_epoch=0
    if [ "$start_epoch" -gt 0 ]; then
      local uptime_secs=$((now - start_epoch))
      uptime_str=$(format_duration "$uptime_secs")
    fi
  fi

  local poll_age_str=""
  if [ -n "$last_poll" ] && [ "$last_poll" != "null" ]; then
    local poll_epoch
    poll_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$last_poll" '+%s' 2>/dev/null) || \
    poll_epoch=$(date -d "$last_poll" '+%s' 2>/dev/null) || poll_epoch=0
    if [ "$poll_epoch" -gt 0 ]; then
      local poll_age=$((now - poll_epoch))
      poll_age_str=$(format_duration "$poll_age")
    fi
  fi

  # Header
  if [ "$orch_alive" = true ]; then
    echo -e "${GREEN}Orchestrator running${NC} (PID $orch_pid, uptime ${uptime_str:-unknown}, last poll ${poll_age_str:-unknown} ago)"
  else
    echo -e "${YELLOW}Orchestrator not running${NC} (last active: ${poll_age_str:-unknown} ago)"
  fi
  echo ""

  # Circuit breaker status
  local cb_failures cb_paused
  cb_failures=$(echo "$status" | jq -r '.circuit_breaker.consecutive_failures')
  cb_paused=$(echo "$status" | jq -r '.circuit_breaker.paused_until')
  if [ "$cb_paused" != "null" ] && [ -n "$cb_paused" ]; then
    local pause_epoch
    pause_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$cb_paused" '+%s' 2>/dev/null) || \
    pause_epoch=$(date -d "$cb_paused" '+%s' 2>/dev/null) || pause_epoch=0
    if [ "$pause_epoch" -gt "$now" ]; then
      local remaining=$((pause_epoch - now))
      echo -e "${YELLOW}  Circuit breaker active — paused for $(format_duration "$remaining")${NC}"
      echo ""
    fi
  fi

  # Workers
  local worker_count
  worker_count=$(echo "$status" | jq '.workers | length')

  if [ "$worker_count" -eq 0 ]; then
    echo "  No active workers"
    echo ""
    echo "0/$max_workers worker slots in use"
    return
  fi

  # Table header
  printf "  ${DIM}%-9s %-16s %9s %11s  %s${NC}\n" "ISSUE" "PHASE" "TIME" "PROGRESS" "BRANCH"

  local i=0
  while [ "$i" -lt "$worker_count" ]; do
    local worker
    worker=$(echo "$status" | jq ".workers[$i]")

    local w_issue w_pid w_branch w_started w_log
    w_issue=$(echo "$worker" | jq -r '.issue')
    w_pid=$(echo "$worker" | jq -r '.pid')
    w_branch=$(echo "$worker" | jq -r '.branch')
    w_started=$(echo "$worker" | jq -r '.started_at')
    w_log=$(echo "$worker" | jq -r '.log_file')

    # Elapsed time
    local elapsed_str="?"
    local w_start_epoch
    w_start_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$w_started" '+%s' 2>/dev/null) || \
    w_start_epoch=$(date -d "$w_started" '+%s' 2>/dev/null) || w_start_epoch=0
    if [ "$w_start_epoch" -gt 0 ]; then
      local w_elapsed=$((now - w_start_epoch))
      elapsed_str=$(format_duration "$w_elapsed")
    fi

    # Git progress (computed first, used by phase detection)
    local progress=""
    local wt_path
    wt_path=$(get_worktree_path "$w_branch")
    if [ -d "$wt_path/.git" ] || [ -f "$wt_path/.git" ]; then
      local ahead=0
      ahead=$(git -C "$wt_path" rev-list --count main..HEAD 2>/dev/null) || true
      local dirty=""
      if [ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ]; then
        dirty="+"
      fi
      progress="${ahead} commit(s)${dirty}"
    else
      progress="initializing"
    fi

    # Phase detection: log markers → auto-implement markers → git heuristics
    local phase="Initializing"
    if [ -f "$w_log" ]; then
      local last_marker
      last_marker=$(grep -o '\[[^]]*:complete\]' "$w_log" 2>/dev/null | tail -1) || true
      case "$last_marker" in
        "[plan-issue:complete]")      phase="Implementing" ;;
        "[implement-issue:complete]") phase="Reviewing" ;;
        "[branch-review:complete]")   phase="Committing" ;;
        "[commit:complete]")          phase="PR review" ;;
        "[create-pr:complete]")       phase="PR review" ;;
        "[review-pr:complete]")       phase="Merging" ;;
        "[merge:complete]")           phase="Done" ;;
        "")
          # Check auto-implement completion
          if grep -qE '\[auto-implement\].*(cycle complete|PR merged)' "$w_log" 2>/dev/null; then
            phase="Done"
          # Git-based heuristics
          elif [ -d "$wt_path/.git" ] || [ -f "$wt_path/.git" ]; then
            if git -C "$wt_path" rev-parse --abbrev-ref '@{upstream}' &>/dev/null; then
              phase="PR review"
            elif [ "$ahead" -gt 0 ]; then
              if [ -n "$dirty" ]; then
                phase="Implementing"
              else
                phase="Reviewing"
              fi
            elif [ -n "$dirty" ]; then
              phase="Implementing"
            elif grep -q "Starting autonomous Claude Code" "$w_log" 2>/dev/null; then
              phase="Planning"
            fi
          elif grep -q "Starting autonomous Claude Code" "$w_log" 2>/dev/null; then
            phase="Planning"
          fi ;;
        *) phase="Unknown" ;;
      esac
    fi

    # Worker alive check
    local alive_indicator=""
    if ! kill -0 "$w_pid" 2>/dev/null; then
      alive_indicator=" ${RED}(dead)${NC}"
    fi

    # Color the phase
    local phase_color="$NC"
    case "$phase" in
      Initializing) phase_color="$DIM" ;;
      Planning)     phase_color="$BLUE" ;;
      Implementing) phase_color="$GREEN" ;;
      Reviewing)    phase_color="$YELLOW" ;;
      Committing)   phase_color="$BLUE" ;;
      "PR review")  phase_color="$YELLOW" ;;
      Merging)      phase_color="$GREEN" ;;
      Done)         phase_color="$GREEN" ;;
    esac

    printf "  %-9s ${phase_color}%-16s${NC} %9s %11s  %s%b\n" \
      "$w_issue" "$phase" "$elapsed_str" "$progress" "$w_branch" "$alive_indicator"

    # Verbose: show changed files and log tail
    if [ "$verbose" = true ]; then
      echo ""

      # Show changed files in worktree
      if [ -d "$wt_path/.git" ] || [ -f "$wt_path/.git" ]; then
        local changed_files
        changed_files=$(git -C "$wt_path" diff --name-only HEAD 2>/dev/null) || true
        local staged_files
        staged_files=$(git -C "$wt_path" diff --cached --name-only 2>/dev/null) || true
        local untracked_files
        untracked_files=$(git -C "$wt_path" ls-files --others --exclude-standard 2>/dev/null) || true

        # Combine and deduplicate
        local all_files
        all_files=$(printf '%s\n%s\n%s' "$changed_files" "$staged_files" "$untracked_files" | sort -u | grep -v '^$') || true

        if [ -n "$all_files" ]; then
          local file_count
          file_count=$(echo "$all_files" | wc -l | tr -d ' ')
          echo -e "    ${DIM}Changed files (${file_count}):${NC}"
          echo "$all_files" | head -15 | while IFS= read -r f; do
            printf "      ${DIM}%s${NC}\n" "$f"
          done
          if [ "$file_count" -gt 15 ]; then
            echo -e "      ${DIM}... and $((file_count - 15)) more${NC}"
          fi
        fi

        # Show diff stat for uncommitted changes
        if [ -n "$all_files" ]; then
          local diff_summary
          diff_summary=$(git -C "$wt_path" diff --shortstat 2>/dev/null) || true
          if [ -n "$diff_summary" ]; then
            printf "      ${DIM}%s${NC}\n" "$diff_summary"
          fi
        fi

        # Show recent commits on branch
        if [ "$ahead" -gt 0 ]; then
          echo ""
          echo -e "    ${DIM}Commits (${ahead}):${NC}"
          git -C "$wt_path" log main..HEAD --oneline 2>/dev/null | head -5 | while IFS= read -r line; do
            printf "      ${DIM}%s${NC}\n" "$line"
          done
          if [ "$ahead" -gt 5 ]; then
            echo -e "      ${DIM}... and $((ahead - 5)) more${NC}"
          fi
        fi

        # Show PR URL if pushed
        local pr_url
        pr_url=$(git -C "$wt_path" rev-parse --abbrev-ref '@{upstream}' &>/dev/null && \
          gh pr view "$w_branch" --json url --jq .url 2>/dev/null) || true
        if [ -n "$pr_url" ]; then
          echo ""
          printf "    ${DIM}PR: %s${NC}\n" "$pr_url"
        fi
      fi

      echo ""
    fi

    i=$((i + 1))
  done

  echo ""
  echo "$worker_count/$max_workers worker slots in use · $cb_failures circuit breaker failure(s)"

  if [ "$orch_alive" = true ]; then
    echo ""
    if [ "$verbose" = true ]; then
      echo -e "${DIM}Tip: watch -n 10 wt status -v${NC}"
    else
      echo -e "${DIM}Tip: wt status -v for details · watch -n 5 wt status${NC}"
    fi
  fi
}

# Format seconds into human-readable duration (e.g., "2h15m", "5m30s")
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

# List all worktrees
cmd_list() {
  echo -e "${BLUE}Active worktrees:${NC}"
  echo ""

  # Get all worktrees
  local worktrees=$(git -C "$REPO_ROOT" worktree list)

  # Check if we have any parallel worktrees
  if ! echo "$worktrees" | grep -q "$WORKTREE_BASE"; then
    echo "No parallel worktrees found."
    echo ""
    echo "Create one with: $0 new <branch-name>"
    return
  fi

  # Show parallel worktrees with details
  echo "$worktrees" | while read -r line; do
    local path=$(echo "$line" | awk '{print $1}')
    local branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')

    # Only show worktrees in our managed directory
    if [[ "$path" == "$WORKTREE_BASE"* ]]; then
      local last_commit=$(git -C "$path" log -1 --format="%s" 2>/dev/null || echo "unknown")
      local short_commit=$(git -C "$path" log -1 --format="%h" 2>/dev/null || echo "???")

      echo -e "${GREEN}$branch${NC}"
      echo "  Path: $path"
      echo "  Last: $short_commit - $last_commit"
      echo ""
    fi
  done

  # Also run the status script if available for more details
  if [ -f "$SCRIPT_DIR/worktree-status.sh" ]; then
    echo "─────────────────────────────────────────"
    echo "Run './scripts/worktree-status.sh' for detailed status"
  fi
}

# Cleanup a specific worktree
cmd_cleanup() {
  local branch="$1"

  # If running from within a worktree, block with helpful message
  if is_in_worktree; then
    local current_branch=$(git branch --show-current)
    local main_repo=$(git rev-parse --git-common-dir | sed 's|/.git$||')

    # If no branch specified, use current branch in the message
    if [ -z "$branch" ]; then
      branch="$current_branch"
    fi

    # Block if trying to clean up the current worktree
    if [ "$current_branch" = "$branch" ]; then
      echo -e "${RED}Error: Cannot clean up current worktree from within it${NC}"
      echo ""
      echo "Detected branch: $current_branch"
      echo ""
      echo "Please exit this directory first:"
      echo "  cd $main_repo"
      echo "  ./scripts/worktree-claude.sh cleanup $branch"
      exit 1
    fi
  fi

  if [ -z "$branch" ]; then
    echo -e "${RED}Error: Branch name required${NC}"
    print_usage
    exit 1
  fi

  local worktree_path=$(get_worktree_path "$branch")

  if [ ! -d "$worktree_path" ]; then
    echo -e "${YELLOW}Worktree not found at $worktree_path${NC}"
    return
  fi

  # Check worktree status before removing
  local status=$(get_worktree_status "$worktree_path")

  echo -e "${BLUE}Worktree: $branch${NC}"
  echo "Location: $worktree_path"
  echo ""

  if [ "$status" = "merged" ]; then
    echo -e "Status: ${GREEN}$status${NC} - safe to remove"
    echo ""
    read -p "Remove this worktree? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Cancelled."
      return
    fi
  else
    echo -e "Status: ${RED}$status${NC}"
    echo ""
    echo -e "${YELLOW}Warning: This worktree has work that may be lost!${NC}"
    echo ""
    read -p "Remove anyway? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Cancelled."
      return
    fi
  fi

  # Sync permissions back to main repo before cleanup
  sync_permissions "$worktree_path"

  # Remove the worktree
  git -C "$REPO_ROOT" worktree remove "$worktree_path" --force

  # Delete the paired Neon branch (no-op if Neon branching disabled)
  neon_delete_branch_for_worktree "$branch"

  # Optionally delete the branch if it wasn't pushed
  echo ""
  read -p "Delete the branch '$branch' as well? (y/N) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git -C "$REPO_ROOT" branch -D "$branch" 2>/dev/null || echo "Branch already deleted or doesn't exist"
  fi

  echo -e "${GREEN}Cleanup complete${NC}"
}

# Detect if we're in a worktree (returns 0 if in worktree, 1 if in main repo)
is_in_worktree() {
  local git_common=$(git rev-parse --git-common-dir 2>/dev/null)
  local git_dir=$(git rev-parse --git-dir 2>/dev/null)
  [ "$git_common" != "$git_dir" ]
}

# Check if a worktree has uncommitted changes
has_uncommitted_changes() {
  local path="$1"
  [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]
}

# Check if a branch has unpushed commits
has_unpushed_commits() {
  local path="$1"
  local branch=$(git -C "$path" branch --show-current 2>/dev/null)

  # Check if remote tracking branch exists
  if git -C "$path" rev-parse --verify "origin/$branch" &>/dev/null; then
    # Has commits ahead of remote
    local ahead=$(git -C "$path" rev-list --count "origin/$branch..$branch" 2>/dev/null || echo "0")
    [ "$ahead" -gt 0 ]
  else
    # No remote tracking branch - consider unpushed if branch has commits not in main
    local ahead=$(git -C "$path" rev-list --count "main..$branch" 2>/dev/null || echo "0")
    [ "$ahead" -gt 0 ]
  fi
}

# Check if a branch is merged into main (handles squash merges)
is_branch_merged() {
  local path="$1"
  local branch=$(git -C "$path" branch --show-current 2>/dev/null)

  # First, check if the branch has any commits ahead of main
  # A branch with no commits ahead is NOT merged - it just hasn't diverged yet
  local ahead=$(git -C "$REPO_ROOT" rev-list --count "main..$branch" 2>/dev/null || echo "0")
  if [ "$ahead" = "0" ]; then
    # No commits ahead of main - this is a fresh branch, not a merged one
    return 1
  fi

  # Method 1: Check if branch is an ancestor of main (regular merge)
  if git -C "$REPO_ROOT" merge-base --is-ancestor "$branch" main 2>/dev/null; then
    return 0
  fi

  # Method 2: Check if PR for this branch was merged (handles squash merges)
  # Look for a merged PR with this branch as head
  if command -v gh &> /dev/null; then
    local pr_state=$(gh pr list --head "$branch" --state merged --json state --jq '.[0].state' 2>/dev/null)
    if [ "$pr_state" = "MERGED" ]; then
      return 0
    fi
  fi

  return 1
}

# Get worktree status summary
get_worktree_status() {
  local path="$1"
  local status=""

  # Check uncommitted changes first (always relevant)
  if has_uncommitted_changes "$path"; then
    status="uncommitted changes"
  fi

  # Check if merged (do this before unpushed check)
  # Squash-merged branches will always have "unpushed" original commits
  if is_branch_merged "$path"; then
    if [ -n "$status" ]; then
      # Has uncommitted changes but PR was merged - unusual state
      status="$status (but merged)"
    else
      status="merged"
    fi
    echo "$status"
    return
  fi

  # Only check unpushed if not merged (avoids false positives for squash merges)
  if has_unpushed_commits "$path"; then
    if [ -n "$status" ]; then
      status="$status, unpushed commits"
    else
      status="unpushed commits"
    fi
  fi

  if [ -z "$status" ]; then
    status="unmerged"
  fi

  echo "$status"
}

# Cleanup all parallel worktrees
cmd_cleanup_all() {
  # If running from within a worktree, warn and exit
  if is_in_worktree; then
    echo -e "${RED}Error: Cannot run cleanup-all from within a worktree${NC}"
    echo ""
    echo "You're currently in: $(pwd)"
    echo ""
    echo "Please run from the main repo:"
    echo "  cd $(git rev-parse --git-common-dir | sed 's|/.git$||')"
    echo "  ./scripts/worktree-claude.sh cleanup-all"
    exit 1
  fi

  # Collect worktree info first
  local safe_worktrees=()
  local safe_branches=()
  local unsafe_worktrees=()
  local unsafe_branches=()
  local all_paths=()
  local all_branches=()
  local all_statuses=()

  while read -r line; do
    local path=$(echo "$line" | awk '{print $1}')
    local branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')

    if [[ "$path" == "$WORKTREE_BASE"* ]]; then
      local status=$(get_worktree_status "$path")
      all_paths+=("$path")
      all_branches+=("$branch")
      all_statuses+=("$status")

      if [ "$status" = "merged" ]; then
        safe_worktrees+=("$path")
        safe_branches+=("$branch")
      else
        unsafe_worktrees+=("$path")
        unsafe_branches+=("$branch")
      fi
    fi
  done < <(git -C "$REPO_ROOT" worktree list)

  if [ ${#all_paths[@]} -eq 0 ]; then
    echo "No parallel worktrees found."
    return
  fi

  # Show status of all worktrees
  echo -e "${BLUE}Worktree status:${NC}"
  echo ""
  for i in "${!all_paths[@]}"; do
    local status="${all_statuses[$i]}"
    local branch="${all_branches[$i]}"
    local path="${all_paths[$i]}"

    if [ "$status" = "merged" ]; then
      echo -e "  ${GREEN}✓${NC} $branch ($status)"
    else
      echo -e "  ${YELLOW}!${NC} $branch (${RED}$status${NC})"
    fi
  done
  echo ""

  # Handle based on what we found
  if [ ${#unsafe_worktrees[@]} -eq 0 ]; then
    # All worktrees are safe to remove
    echo -e "${GREEN}All worktrees are merged and safe to remove.${NC}"
    read -p "Remove all ${#safe_worktrees[@]} worktree(s)? (y/N) " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Cancelled."
      return
    fi

    for i in "${!safe_worktrees[@]}"; do
      local path="${safe_worktrees[$i]}"
      local branch="${safe_branches[$i]}"
      sync_permissions "$path"
      echo "Removing: $path"
      if git -C "$REPO_ROOT" worktree remove "$path" --force 2>/dev/null; then
        neon_delete_branch_for_worktree "$branch"
      else
        echo -e "${YELLOW}Worktree remove failed for $path — keeping Neon branch${NC}" >&2
      fi
    done
  elif [ ${#safe_worktrees[@]} -eq 0 ]; then
    # No safe worktrees, all have work in progress
    echo -e "${YELLOW}All worktrees have work in progress.${NC}"
    echo ""
    echo "Options:"
    echo "  1) Cancel - keep all worktrees"
    echo "  2) Force remove all (will lose uncommitted/unpushed work!)"
    echo ""
    read -p "Choose [1-2]: " -n 1 -r
    echo ""

    if [[ $REPLY == "2" ]]; then
      echo ""
      echo -e "${RED}WARNING: This will permanently delete uncommitted/unpushed work!${NC}"
      read -p "Type 'yes' to confirm: " confirm
      if [ "$confirm" = "yes" ]; then
        for i in "${!unsafe_worktrees[@]}"; do
          local path="${unsafe_worktrees[$i]}"
          local branch="${unsafe_branches[$i]}"
          sync_permissions "$path"
          echo "Force removing: $path"
          if git -C "$REPO_ROOT" worktree remove "$path" --force 2>/dev/null; then
            neon_delete_branch_for_worktree "$branch"
          else
            echo -e "${YELLOW}Worktree remove failed for $path — keeping Neon branch${NC}" >&2
          fi
        done
      else
        echo "Cancelled."
        return
      fi
    else
      echo "Cancelled."
      return
    fi
  else
    # Mix of safe and unsafe worktrees
    echo "Options:"
    echo "  1) Remove only merged worktrees (${#safe_worktrees[@]} worktree(s))"
    echo "  2) Force remove all (will lose uncommitted/unpushed work!)"
    echo "  3) Cancel"
    echo ""
    read -p "Choose [1-3]: " -n 1 -r
    echo ""

    case $REPLY in
      1)
        for i in "${!safe_worktrees[@]}"; do
          local path="${safe_worktrees[$i]}"
          local branch="${safe_branches[$i]}"
          sync_permissions "$path"
          echo "Removing: $path"
          if git -C "$REPO_ROOT" worktree remove "$path" --force 2>/dev/null; then
            neon_delete_branch_for_worktree "$branch"
          else
            echo -e "${YELLOW}Worktree remove failed for $path — keeping Neon branch${NC}" >&2
          fi
        done
        echo ""
        echo -e "${YELLOW}Kept ${#unsafe_worktrees[@]} worktree(s) with work in progress.${NC}"
        ;;
      2)
        echo ""
        echo -e "${RED}WARNING: This will permanently delete uncommitted/unpushed work!${NC}"
        read -p "Type 'yes' to confirm: " confirm
        if [ "$confirm" = "yes" ]; then
          for i in "${!all_paths[@]}"; do
            local path="${all_paths[$i]}"
            local branch="${all_branches[$i]}"
            sync_permissions "$path"
            echo "Force removing: $path"
            if git -C "$REPO_ROOT" worktree remove "$path" --force 2>/dev/null; then
              neon_delete_branch_for_worktree "$branch"
            else
              echo -e "${YELLOW}Worktree remove failed for $path — keeping Neon branch${NC}" >&2
            fi
          done
        else
          echo "Cancelled."
          return
        fi
        ;;
      *)
        echo "Cancelled."
        return
        ;;
    esac
  fi

  # Prune any stale worktrees
  git -C "$REPO_ROOT" worktree prune

  echo -e "${GREEN}Cleanup complete${NC}"
}

# Sync permissions from a specific worktree
cmd_sync() {
  local branch="$1"
  if [ -z "$branch" ]; then
    echo -e "${RED}Error: Branch name required${NC}"
    print_usage
    exit 1
  fi

  local worktree_path=$(get_worktree_path "$branch")

  if [ ! -d "$worktree_path" ]; then
    echo -e "${RED}Error: Worktree not found at $worktree_path${NC}"
    echo "Use 'list' to see available worktrees."
    exit 1
  fi

  echo -e "${BLUE}Syncing permissions from: $branch${NC}"
  sync_permissions "$worktree_path"
  echo -e "${GREEN}Done${NC}"
}

# Sync permissions from all worktrees
cmd_sync_all() {
  echo -e "${BLUE}Syncing permissions from all worktrees...${NC}"
  echo ""

  local found=false

  # Get all worktrees in our managed directory
  while read -r line; do
    local path=$(echo "$line" | awk '{print $1}')
    local branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')

    if [[ "$path" == "$WORKTREE_BASE"* ]]; then
      found=true
      echo "Checking: $branch"
      sync_permissions "$path"
    fi
  done < <(git -C "$REPO_ROOT" worktree list)

  if [ "$found" = false ]; then
    echo "No parallel worktrees found."
  fi

  echo ""
  echo -e "${GREEN}Sync complete${NC}"
}

# ─── Shared: timezone offset (computed once) ──────────────────────────────────

get_tz_offset_sec() {
  local tz_raw tz_sign tz_hours tz_mins
  tz_raw=$(date +%z)
  tz_sign="${tz_raw:0:1}"
  tz_hours=$((10#${tz_raw:1:2}))
  tz_mins=$((10#${tz_raw:3:2}))
  local offset=$(( tz_hours * 3600 + tz_mins * 60 ))
  [ "$tz_sign" = "-" ] && offset=$(( -offset ))
  echo "$offset"
}

# ─── Shared: jq filter for JSONL → readable log ──────────────────────────────

# Shared jq program used by both cmd_logs and cmd_watch.
# Expects: --argjson tz <offset_sec>
# Input: one JSONL line per invocation (or piped stream)
JQ_LOG_FILTER='
  def short_path: (. // "?" | split("/") | last);
  def local_ts:
    if (. // "" | length) < 16 then "     "
    else
      (.[11:13] | tonumber) as $h |
      (.[14:16] | tonumber) as $m |
      (($h * 3600 + $m * 60 + $tz) % 86400) |
      if . < 0 then . + 86400 else . end |
      "\(. / 3600 | floor | tostring | if length < 2 then "0" + . else . end):\(. % 3600 / 60 | floor | tostring | if length < 2 then "0" + . else . end)"
    end;

  if .type == "assistant" then
    (.timestamp // "" | local_ts) as $ts |
    [.message.content[] |
      if .type == "text" then
        "        \(.text | gsub("\n"; "\n        ") | .[0:500])"
      elif .type == "tool_use" then
        if .name == "Edit" then
          "\($ts)  Edit " + (.input.file_path | short_path)
        elif .name == "Write" then
          "\($ts)  Write " + (.input.file_path | short_path)
        elif .name == "Read" then
          "\($ts)  Read " + (.input.file_path | short_path)
        elif .name == "Bash" then
          "\($ts)  $ " + (.input.description // (.input.command // "?" | split("\n") | first | .[0:100]))
        elif .name == "Grep" then
          "\($ts)  Grep " + (.input.pattern // "?") + " in " + (.input.path // "." | short_path)
        elif .name == "Glob" then
          "\($ts)  Glob " + (.input.pattern // "?")
        elif .name == "Agent" then
          "\($ts)  Agent: " + (.input.description // "?")
        elif .name == "Skill" then
          "\($ts)  /" + (.input.skill // "?")
        elif .name == "TodoWrite" then
          empty
        elif (.name | startswith("mcp__")) then
          "\($ts)  " + (.name | split("__") | .[1:] | join("."))
        else
          "\($ts)  " + .name
        end
      else empty
      end
    ] | join("\n")
  elif .type == "user" then
    (.message.content | if type == "array" then
      [.[] |
        if .type == "tool_result" and .is_error == true then
          "  \u001b[31m✗ " + (.content | tostring | .[0:150]) + "\u001b[0m"
        else empty
        end
      ] | if length > 0 then join("\n") else empty end
    else empty end)
  else empty
  end
'

# ─── Shared: render JSONL tail into readable log lines ────────────────────────

# Usage: render_log_lines <jsonl_file> <num_lines> <tz_offset>
# Outputs formatted log lines to stdout
render_log_lines() {
  local jsonl_file="$1" num_lines="$2" tz_offset="$3"
  tail -"$num_lines" "$jsonl_file" 2>/dev/null | \
    jq -r --argjson tz "$tz_offset" "$JQ_LOG_FILTER" 2>/dev/null | \
    grep -v '^$' | \
    sed -E 's|(lin_api_\|sk-ant-\|Bearer \|Authorization: )[^ "]+|\1***|g' | \
    sed -E "s|$HOME/.worktrees/[^/]+/[^/]+/||g"
}

# ─── Shared: find JSONL session file for an issue ─────────────────────────────

# Usage: find_session_jsonl <search_term>
# Sets REPLY to the jsonl file path, or empty if not found
find_session_jsonl() {
  local search_term="$1"
  local session_dir
  session_dir=$(find "$HOME/.claude/projects" -maxdepth 1 -type d -iname "*worktrees*${REPO_NAME}*${search_term}*" 2>/dev/null | head -1)
  [ -z "$session_dir" ] && REPLY="" && return 1
  REPLY=$(ls -t "$session_dir"/*.jsonl 2>/dev/null | head -1)
  [ -z "$REPLY" ] && return 1
  return 0
}

# Show recent Claude activity from session JSONL
cmd_logs() {
  local query="$1"
  local lines="${2:-20}"

  if [ -z "$query" ]; then
    echo -e "${RED}Error: Issue ID or branch name required${NC}"
    echo "Usage: wt logs <issue-id|branch> [lines]"
    echo "Example: wt logs HON-373"
    echo "         wt logs HON-373 50"
    exit 1
  fi

  # Normalize issue ID
  local search_term
  if [[ "$query" =~ ^[0-9]+$ ]]; then
    search_term="hon-${query}"
  else
    search_term=$(echo "$query" | tr '[:upper:]' '[:lower:]')
  fi

  if ! find_session_jsonl "$search_term"; then
    echo -e "${RED}No session found for: $query${NC}"
    return 1
  fi
  local jsonl_file="$REPLY"

  local total_lines
  total_lines=$(wc -l < "$jsonl_file" | tr -d ' ')

  echo -e "${BLUE}Session:${NC} $(basename "$(dirname "$jsonl_file")")"
  echo -e "${DIM}$jsonl_file ($total_lines messages)${NC}"
  echo ""

  render_log_lines "$jsonl_file" "$lines" "$(get_tz_offset_sec)"
}

# ─── Live dashboard ───────────────────────────────────────────────────────────

cmd_watch() {
  local interval="${1:-5}"
  local status_file="$WORKTREE_BASE/orchestrator-status.json"
  local tz_offset
  tz_offset=$(get_tz_offset_sec)

  # Clean exit on Ctrl-C: show cursor, clear to end, print message
  trap 'tput cnorm 2>/dev/null; tput ed 2>/dev/null; echo ""; exit 0' INT TERM

  tput civis 2>/dev/null  # hide cursor during updates

  while true; do
    local buf=""
    local now
    now=$(date +%s)
    local term_lines
    term_lines=$(tput lines 2>/dev/null || echo 40)

    # ── Header ──
    if [ ! -f "$status_file" ]; then
      buf+="${YELLOW}Orchestrator not running${NC}\n"
    else
      local status
      status=$(cat "$status_file" 2>/dev/null) || { buf+="${RED}Error reading status${NC}\n"; }

      if [ -n "${status:-}" ]; then
        local orch_pid started_at last_poll max_workers
        orch_pid=$(echo "$status" | jq -r '.pid')
        started_at=$(echo "$status" | jq -r '.started_at')
        last_poll=$(echo "$status" | jq -r '.last_poll')
        max_workers=$(echo "$status" | jq -r '.max_workers // 5')

        # Orchestrator liveness
        local orch_alive=false
        if [ -n "$orch_pid" ] && kill -0 "$orch_pid" 2>/dev/null; then
          orch_alive=true
        fi

        # Uptime
        local uptime_str="?"
        local start_epoch
        start_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$started_at" '+%s' 2>/dev/null) || \
        start_epoch=$(date -d "$started_at" '+%s' 2>/dev/null) || start_epoch=0
        if [ "$start_epoch" -gt 0 ]; then
          uptime_str=$(format_duration $((now - start_epoch)))
        fi

        # Poll age
        local poll_age_str="?"
        local poll_epoch
        poll_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$last_poll" '+%s' 2>/dev/null) || \
        poll_epoch=$(date -d "$last_poll" '+%s' 2>/dev/null) || poll_epoch=0
        if [ "$poll_epoch" -gt 0 ]; then
          poll_age_str=$(format_duration $((now - poll_epoch)))
        fi

        local worker_count
        worker_count=$(echo "$status" | jq '.workers | length')
        local cb_failures
        cb_failures=$(echo "$status" | jq -r '.circuit_breaker.consecutive_failures')

        if [ "$orch_alive" = true ]; then
          buf+="${GREEN}Orchestrator running${NC} (uptime ${uptime_str}, poll ${poll_age_str} ago) · "
        else
          buf+="${YELLOW}Orchestrator stopped${NC} (last active ${poll_age_str} ago) · "
        fi
        buf+="${worker_count}/${max_workers} workers"
        [ "$cb_failures" -gt 0 ] 2>/dev/null && buf+=" · ${YELLOW}${cb_failures} CB failure(s)${NC}"
        buf+="\n\n"

        # ── Worker table ──
        if [ "$worker_count" -eq 0 ]; then
          buf+="  ${DIM}No active workers${NC}\n"
        else
          buf+="$(printf "  ${DIM}%-9s %-16s %7s %13s  %s${NC}" "ISSUE" "PHASE" "TIME" "PROGRESS" "BRANCH")\n"

          # Compute log lines per worker: fill remaining terminal space
          # Account for: header(2) + blank(1) + table header(1) + worker rows + blank(1) + separator per worker(1)
          local chrome_lines=$(( 5 + worker_count + worker_count ))
          local remaining=$(( term_lines - chrome_lines ))
          local lines_per_worker=$(( remaining / worker_count ))
          [ "$lines_per_worker" -lt 3 ] && lines_per_worker=3
          [ "$lines_per_worker" -gt 12 ] && lines_per_worker=12
          # Fetch more JSONL messages than display lines (some messages produce no output)
          local msgs_per_worker=$(( lines_per_worker * 3 ))

          # Collect per-worker data in a single loop
          local w_issues=() w_pids=() w_branches=() w_logs=() w_phases=() w_elapsed=() w_progress=() w_alive=()
          local i=0
          while [ "$i" -lt "$worker_count" ]; do
            local worker
            worker=$(echo "$status" | jq -c ".workers[$i]")

            w_issues+=("$(echo "$worker" | jq -r '.issue')")
            w_pids+=("$(echo "$worker" | jq -r '.pid')")
            w_branches+=("$(echo "$worker" | jq -r '.branch')")
            w_logs+=("$(echo "$worker" | jq -r '.log_file')")
            local w_started
            w_started=$(echo "$worker" | jq -r '.started_at')

            # Elapsed time
            local w_start_epoch=0
            w_start_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$w_started" '+%s' 2>/dev/null) || \
            w_start_epoch=$(date -d "$w_started" '+%s' 2>/dev/null) || w_start_epoch=0
            if [ "$w_start_epoch" -gt 0 ]; then
              w_elapsed+=("$(format_duration $((now - w_start_epoch)))")
            else
              w_elapsed+=("?")
            fi

            # Git progress + phase detection
            local ahead=0 dirty="" wt_path progress phase="Initializing"
            wt_path=$(get_worktree_path "${w_branches[$i]}")
            if [ -d "$wt_path/.git" ] || [ -f "$wt_path/.git" ]; then
              ahead=$(git -C "$wt_path" rev-list --count main..HEAD 2>/dev/null) || true
              [ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ] && dirty="+"
              progress="${ahead} commit(s)${dirty}"
            else
              progress="setting up"
            fi
            w_progress+=("$progress")

            # Phase detection (from log markers + git heuristics)
            local w_log="${w_logs[$i]}"
            if [ -f "$w_log" ]; then
              local last_marker
              last_marker=$(grep -o '\[[^]]*:complete\]' "$w_log" 2>/dev/null | tail -1) || true
              case "$last_marker" in
                "[plan-issue:complete]")      phase="Implementing" ;;
                "[implement-issue:complete]") phase="Reviewing" ;;
                "[branch-review:complete]")   phase="Committing" ;;
                "[commit:complete]")          phase="PR review" ;;
                "[create-pr:complete]")       phase="PR review" ;;
                "[review-pr:complete]")       phase="Merging" ;;
                "[merge:complete]")           phase="Done" ;;
                "")
                  if grep -qE '\[auto-implement\].*(cycle complete|PR merged)' "$w_log" 2>/dev/null; then
                    phase="Done"
                  elif [ -d "$wt_path/.git" ] || [ -f "$wt_path/.git" ]; then
                    if git -C "$wt_path" rev-parse --abbrev-ref '@{upstream}' &>/dev/null; then
                      phase="PR review"
                    elif [ "$ahead" -gt 0 ]; then
                      [ -n "$dirty" ] && phase="Implementing" || phase="Reviewing"
                    elif [ -n "$dirty" ]; then
                      phase="Implementing"
                    elif grep -q "Starting autonomous Claude Code" "$w_log" 2>/dev/null; then
                      phase="Planning"
                    fi
                  elif grep -q "Starting autonomous Claude Code" "$w_log" 2>/dev/null; then
                    phase="Planning"
                  fi ;;
                *) phase="Unknown" ;;
              esac
            fi
            w_phases+=("$phase")

            # Alive check
            if kill -0 "${w_pids[$i]}" 2>/dev/null; then
              w_alive+=("")
            else
              w_alive+=(" ${RED}(dead)${NC}")
            fi

            i=$((i + 1))
          done

          # Render worker table rows
          i=0
          while [ "$i" -lt "$worker_count" ]; do
            local phase_color="$NC"
            case "${w_phases[$i]}" in
              Initializing) phase_color="$DIM" ;;
              Planning)     phase_color="$BLUE" ;;
              Implementing) phase_color="$GREEN" ;;
              Reviewing)    phase_color="$YELLOW" ;;
              Committing)   phase_color="$BLUE" ;;
              "PR review")  phase_color="$YELLOW" ;;
              Merging)      phase_color="$GREEN" ;;
              Done)         phase_color="$GREEN" ;;
            esac

            buf+="$(printf "  %-9s ${phase_color}%-16s${NC} %7s %13s  %s" \
              "${w_issues[$i]}" "${w_phases[$i]}" "${w_elapsed[$i]}" "${w_progress[$i]}" "${w_branches[$i]}")${w_alive[$i]}\n"
            i=$((i + 1))
          done

          # ── Log tails per worker ──
          buf+="\n"
          local separator_line="──────────────────────────────────────────────────────"
          i=0
          while [ "$i" -lt "$worker_count" ]; do
            buf+="${DIM}─── ${NC}${w_issues[$i]}${DIM} ${separator_line:0:$((50 - ${#w_issues[$i]}))}${NC}\n"

            local search_term
            search_term=$(echo "${w_issues[$i]}" | tr '[:upper:]' '[:lower:]')

            if find_session_jsonl "$search_term"; then
              local log_output
              log_output=$(render_log_lines "$REPLY" "$msgs_per_worker" "$tz_offset" | tail -"$lines_per_worker")
              if [ -n "$log_output" ]; then
                buf+="$log_output\n"
              else
                buf+="  ${DIM}(no activity yet)${NC}\n"
              fi
            else
              buf+="  ${DIM}(no session found)${NC}\n"
            fi

            i=$((i + 1))
          done
        fi
      fi
    fi

    # ── Render ──
    clear
    echo -e "$buf"

    sleep "$interval"
  done
}

# ─── Orchestrator lifecycle ────────────────────────────────────────────────────

cmd_start() {
  local pid_file="$WORKTREE_BASE/orchestrator.pid"
  local log_dir="$WORKTREE_BASE/logs"
  local log_file="$log_dir/orchestrator.log"

  # Check if already running
  if [ -f "$pid_file" ]; then
    local existing_pid
    existing_pid=$(cat "$pid_file" 2>/dev/null) || true
    if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
      echo -e "${YELLOW}Orchestrator already running (PID $existing_pid)${NC}"
      echo "Use 'wt stop' to stop it first, or 'wt status' to check."
      return 1
    fi
  fi

  # .env is sourced by the top-level dispatcher; just validate the orchestrator's
  # required var here.
  if [ -z "${LINEAR_API_KEY:-}" ]; then
    echo -e "${RED}Error: LINEAR_API_KEY not set (check $REPO_ROOT/.env)${NC}"
    return 1
  fi

  mkdir -p "$log_dir"

  # Pass through any extra flags (--max-workers, --once, etc.)
  nohup "$SCRIPT_DIR/orchestrator.sh" "$@" >> "$log_file" 2>&1 &
  local new_pid=$!

  # Brief wait to check it didn't die immediately
  sleep 1
  if kill -0 "$new_pid" 2>/dev/null; then
    echo -e "${GREEN}Orchestrator started (PID $new_pid)${NC}"
    echo -e "${DIM}Log: $log_file${NC}"
    echo ""
    echo "Use 'wt watch' for live dashboard, 'wt stop' to stop."
  else
    echo -e "${RED}Orchestrator failed to start. Check log:${NC}"
    echo -e "${DIM}$log_file${NC}"
    tail -5 "$log_file" 2>/dev/null
    return 1
  fi
}

cmd_stop() {
  local pid_file="$WORKTREE_BASE/orchestrator.pid"

  if [ ! -f "$pid_file" ]; then
    echo -e "${YELLOW}No orchestrator PID file found.${NC}"
    return 1
  fi

  local pid
  pid=$(cat "$pid_file" 2>/dev/null) || true

  if [ -z "$pid" ]; then
    echo -e "${YELLOW}Empty PID file.${NC}"
    rm -f "$pid_file"
    return 1
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    echo -e "${YELLOW}Orchestrator not running (stale PID $pid). Cleaning up.${NC}"
    rm -f "$pid_file"
    return 0
  fi

  echo -e "${BLUE}Stopping orchestrator (PID $pid)...${NC}"
  echo -e "${DIM}Sending SIGTERM (graceful — waits for workers to finish)${NC}"
  kill -TERM "$pid" 2>/dev/null

  # Wait up to 15s for graceful shutdown
  local waited=0
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 15 ]; do
    sleep 1
    waited=$((waited + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    echo -e "${YELLOW}Still running (workers active). Sending second SIGTERM to force kill workers...${NC}"
    kill -TERM "$pid" 2>/dev/null || true
    sleep 3
  fi

  if kill -0 "$pid" 2>/dev/null; then
    echo -e "${YELLOW}Sending SIGKILL...${NC}"
    kill -9 "$pid" 2>/dev/null || true
  fi

  echo -e "${GREEN}Orchestrator stopped.${NC}"
}

# Load .env so NEON_API_KEY / NEON_PROJECT_ID (and anything else) are
# available to every subcommand. Silent no-op if .env is missing — commands
# that genuinely require specific vars validate them explicitly (cmd_start
# validates LINEAR_API_KEY, neon_enabled validates NEON_*).
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

# Main command router
case "${1:-}" in
  start)
    shift
    cmd_start "$@"
    exit $?
    ;;
  stop)
    cmd_stop
    ;;
  new)
    shift
    cmd_new "$@"
    ;;
  auto)
    shift
    cmd_auto "$@"
    ;;
  resume)
    cmd_resume "$2"
    ;;
  list)
    cmd_list
    ;;
  status)
    cmd_status "$2"
    ;;
  logs)
    cmd_logs "$2" "${3:-20}"
    ;;
  watch)
    cmd_watch "${2:-5}"
    ;;
  cleanup)
    cmd_cleanup "$2"
    ;;
  cleanup-all)
    cmd_cleanup_all
    ;;
  neon-delete)
    # Non-interactive Neon-branch delete for external callers (e.g. orchestrator).
    # Same semantics as the cleanup hook: degrades silently if Neon isn't configured,
    # refuses protected names, never fails loud.
    neon_delete_branch_for_worktree "$2"
    ;;
  sync)
    cmd_sync "$2"
    ;;
  sync-all)
    cmd_sync_all
    ;;
  -h|--help|help)
    print_usage
    ;;
  *)
    if [ -n "$1" ]; then
      echo -e "${RED}Unknown command: $1${NC}"
      echo ""
    fi
    print_usage
    exit 1
    ;;
esac

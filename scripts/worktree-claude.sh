#!/bin/bash
# Parallel Claude Code Worktree Manager
#
# Manages git worktrees for running multiple Claude Code instances in parallel.
# Each worktree is isolated, allowing concurrent work on different features.
#
# Usage:
#   ./scripts/worktree-claude.sh new <branch-name>      # Create new worktree + start Claude
#   ./scripts/worktree-claude.sh auto [issue-id]        # Create worktree + run /auto-implement autonomously
#   ./scripts/worktree-claude.sh resume <branch-name>   # Resume existing worktree
#   ./scripts/worktree-claude.sh list                   # List all worktrees
#   ./scripts/worktree-claude.sh sync <branch-name>     # Sync permissions to main repo
#   ./scripts/worktree-claude.sh sync-all               # Sync permissions from all worktrees
#   ./scripts/worktree-claude.sh cleanup <branch-name>  # Remove worktree (auto-syncs)
#   ./scripts/worktree-claude.sh cleanup-all            # Remove all parallel worktrees (auto-syncs)
#
# Worktrees are created in ~/.worktrees/honkadori/<branch-name>

set -e

# Configuration
REPO_NAME="honkadori"
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

print_usage() {
  echo "Usage: $0 <command> [branch-name|issue-id]"
  echo ""
  echo "Commands:"
  echo "  new <branch-name>      Create new worktree and start Claude Code"
  echo "  auto [issue-id]        Create worktree and run /auto-implement autonomously"
  echo "  resume <branch-name>   Open Claude Code in existing worktree"
  echo "  list                   List all active worktrees"
  echo "  sync <branch-name>     Sync permissions from worktree to main repo"
  echo "  sync-all               Sync permissions from all worktrees"
  echo "  cleanup <branch-name>  Remove a specific worktree (auto-syncs permissions)"
  echo "  cleanup-all            Remove all parallel worktrees (auto-syncs permissions)"
  echo ""
  echo "Examples:"
  echo "  $0 new feat/api-caching"
  echo "  $0 auto HON-51          # Autonomous implementation of specific issue"
  echo "  $0 auto                 # Autonomous implementation of next available issue"
  echo "  $0 resume feat/api-caching"
  echo "  $0 sync feat/api-caching"
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
  local branch="$1"
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

  # Install dependencies
  echo "Installing dependencies..."
  if command -v pnpm &> /dev/null; then
    pnpm install
    pnpm db:generate
  else
    echo -e "${YELLOW}Warning: pnpm not found, skipping dependency installation${NC}"
  fi

  echo ""
  echo -e "${GREEN}Worktree ready!${NC}"
  echo ""
  echo "Starting Claude Code..."
  echo "─────────────────────────────────────────"
  echo ""

  # Start Claude Code in the worktree
  exec claude
}

# Fully autonomous worktree - creates worktree and runs /auto-implement
cmd_auto() {
  local issue_id="$1"
  local branch
  local prompt

  # Generate branch name and prompt based on whether issue ID is provided
  if [ -n "$issue_id" ]; then
    # Normalize issue ID to lowercase for branch name
    branch="auto/$(echo "$issue_id" | tr '[:upper:]' '[:lower:]')"
    prompt="/auto-implement $issue_id"
  else
    # No issue ID - use timestamp for unique branch, let /auto-implement find next issue
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

  # Create worktree with new branch from current HEAD
  git -C "$REPO_ROOT" worktree add -b "$branch" "$worktree_path"

  echo ""
  echo -e "${BLUE}Setting up worktree...${NC}"
  echo ""

  cd "$worktree_path"

  # Copy untracked files from main repo (.env, Claude settings, etc.)
  copy_untracked_files "$worktree_path"

  # Install dependencies
  echo "Installing dependencies..."
  if command -v pnpm &> /dev/null; then
    pnpm install
    pnpm db:generate
  else
    echo -e "${YELLOW}Warning: pnpm not found, skipping dependency installation${NC}"
  fi

  echo ""
  echo -e "${GREEN}Worktree ready!${NC}"
  echo ""
  echo "Starting autonomous Claude Code with: $prompt"
  echo "─────────────────────────────────────────"
  echo ""

  # Start Claude Code with permissions bypassed and auto-implement prompt
  exec claude --dangerously-skip-permissions "$prompt"
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
  exec claude --resume
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
  local unsafe_worktrees=()
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
      else
        unsafe_worktrees+=("$path")
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

    for path in "${safe_worktrees[@]}"; do
      sync_permissions "$path"
      echo "Removing: $path"
      git -C "$REPO_ROOT" worktree remove "$path" --force 2>/dev/null || true
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
        for path in "${unsafe_worktrees[@]}"; do
          sync_permissions "$path"
          echo "Force removing: $path"
          git -C "$REPO_ROOT" worktree remove "$path" --force 2>/dev/null || true
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
        for path in "${safe_worktrees[@]}"; do
          sync_permissions "$path"
          echo "Removing: $path"
          git -C "$REPO_ROOT" worktree remove "$path" --force 2>/dev/null || true
        done
        echo ""
        echo -e "${YELLOW}Kept ${#unsafe_worktrees[@]} worktree(s) with work in progress.${NC}"
        ;;
      2)
        echo ""
        echo -e "${RED}WARNING: This will permanently delete uncommitted/unpushed work!${NC}"
        read -p "Type 'yes' to confirm: " confirm
        if [ "$confirm" = "yes" ]; then
          for path in "${all_paths[@]}"; do
            sync_permissions "$path"
            echo "Force removing: $path"
            git -C "$REPO_ROOT" worktree remove "$path" --force 2>/dev/null || true
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

# Main command router
case "${1:-}" in
  new)
    cmd_new "$2"
    ;;
  auto)
    cmd_auto "$2"
    ;;
  resume)
    cmd_resume "$2"
    ;;
  list)
    cmd_list
    ;;
  cleanup)
    cmd_cleanup "$2"
    ;;
  cleanup-all)
    cmd_cleanup_all
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

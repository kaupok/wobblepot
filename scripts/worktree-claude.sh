#!/bin/bash
# Parallel Claude Code Worktree Manager
#
# Manages git worktrees for running multiple Claude Code instances in parallel.
# Each worktree is isolated, allowing concurrent work on different features.
#
# Usage:
#   ./scripts/worktree-claude.sh new <branch-name>      # Create new worktree + start Claude
#   ./scripts/worktree-claude.sh resume <branch-name>   # Resume existing worktree
#   ./scripts/worktree-claude.sh list                   # List all worktrees
#   ./scripts/worktree-claude.sh cleanup <branch-name>  # Remove worktree
#   ./scripts/worktree-claude.sh cleanup-all            # Remove all parallel worktrees
#
# Worktrees are created in ~/.worktrees/honkadori/<branch-name>

set -e

# Configuration
REPO_NAME="honkadori"
WORKTREE_BASE="$HOME/.worktrees/$REPO_NAME"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_usage() {
  echo "Usage: $0 <command> [branch-name]"
  echo ""
  echo "Commands:"
  echo "  new <branch-name>      Create new worktree and start Claude Code"
  echo "  resume <branch-name>   Open Claude Code in existing worktree"
  echo "  list                   List all active worktrees"
  echo "  cleanup <branch-name>  Remove a specific worktree"
  echo "  cleanup-all            Remove all parallel worktrees"
  echo ""
  echo "Examples:"
  echo "  $0 new feat/api-caching"
  echo "  $0 resume feat/api-caching"
  echo "  $0 cleanup feat/api-caching"
}

# Normalize branch name to filesystem-safe path
normalize_branch() {
  echo "$1" | tr '/' '-'
}

# Get worktree path for a branch
get_worktree_path() {
  local branch="$1"
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
  echo -e "${BLUE}Setting up worktree (installing dependencies)...${NC}"
  echo ""

  # Run setup script (reuse cyrus-setup.sh logic)
  cd "$worktree_path"

  # Install dependencies
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

  echo -e "${BLUE}Removing worktree: $branch${NC}"
  echo "Location: $worktree_path"

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

# Cleanup all parallel worktrees
cmd_cleanup_all() {
  echo -e "${YELLOW}This will remove ALL parallel worktrees in $WORKTREE_BASE${NC}"
  read -p "Are you sure? (y/N) " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    return
  fi

  # Get all worktrees in our managed directory
  git -C "$REPO_ROOT" worktree list | while read -r line; do
    local path=$(echo "$line" | awk '{print $1}')

    if [[ "$path" == "$WORKTREE_BASE"* ]]; then
      echo "Removing: $path"
      git -C "$REPO_ROOT" worktree remove "$path" --force 2>/dev/null || true
    fi
  done

  # Prune any stale worktrees
  git -C "$REPO_ROOT" worktree prune

  echo -e "${GREEN}All parallel worktrees removed${NC}"
}

# Main command router
case "${1:-}" in
  new)
    cmd_new "$2"
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

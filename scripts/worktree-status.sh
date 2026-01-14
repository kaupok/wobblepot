#!/bin/bash
# Parallel Worktree Status Dashboard
#
# Shows status of all active parallel worktrees including:
# - Branch name and path
# - Last commit
# - Whether Claude Code is running
# - Disk usage
#
# Usage: ./scripts/worktree-status.sh

set -e

# Configuration
REPO_NAME="honkadori"
WORKTREE_BASE="$HOME/.worktrees/$REPO_NAME"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Parallel Claude Code Worktrees - Status Dashboard${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Get all worktrees
worktrees=$(git -C "$REPO_ROOT" worktree list 2>/dev/null)

# Count parallel worktrees
parallel_count=0
while read -r line; do
  path=$(echo "$line" | awk '{print $1}')
  if [[ "$path" == "$WORKTREE_BASE"* ]]; then
    ((parallel_count++))
  fi
done <<< "$worktrees"

if [ "$parallel_count" -eq 0 ]; then
  echo -e "${DIM}No parallel worktrees found.${NC}"
  echo ""
  echo "Create one with:"
  echo -e "  ${CYAN}./scripts/worktree-claude.sh new feat/my-feature${NC}"
  echo ""
  exit 0
fi

echo -e "${GREEN}Found $parallel_count parallel worktree(s)${NC}"
echo ""

# Show details for each parallel worktree
while read -r line; do
  path=$(echo "$line" | awk '{print $1}')
  commit=$(echo "$line" | awk '{print $2}')
  branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')

  # Only show worktrees in our managed directory
  if [[ "$path" == "$WORKTREE_BASE"* ]]; then
    echo -e "${CYAN}┌─────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│${NC} ${GREEN}$branch${NC}"
    echo -e "${CYAN}├─────────────────────────────────────────────────────────────┤${NC}"

    # Path
    echo -e "${CYAN}│${NC} ${DIM}Path:${NC}   $path"

    # Last commit info
    if [ -d "$path" ]; then
      last_msg=$(git -C "$path" log -1 --format="%s" 2>/dev/null | head -c 50 || echo "unknown")
      last_hash=$(git -C "$path" log -1 --format="%h" 2>/dev/null || echo "???")
      last_time=$(git -C "$path" log -1 --format="%ar" 2>/dev/null || echo "unknown")
      echo -e "${CYAN}│${NC} ${DIM}Commit:${NC} $last_hash - $last_msg"
      echo -e "${CYAN}│${NC} ${DIM}When:${NC}   $last_time"

      # Check for uncommitted changes
      changes=$(git -C "$path" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
      if [ "$changes" -gt 0 ]; then
        echo -e "${CYAN}│${NC} ${YELLOW}Status: $changes uncommitted change(s)${NC}"
      else
        echo -e "${CYAN}│${NC} ${DIM}Status:${NC} Clean working tree"
      fi

      # Disk usage (node_modules can be large)
      if command -v du &> /dev/null; then
        size=$(du -sh "$path" 2>/dev/null | awk '{print $1}')
        echo -e "${CYAN}│${NC} ${DIM}Size:${NC}   $size"
      fi

      # Check if Claude Code is running in this directory
      # Look for claude processes with this path in their cwd
      claude_running=false
      if command -v pgrep &> /dev/null; then
        # Check if any claude process has this worktree as cwd
        for pid in $(pgrep -f "claude" 2>/dev/null); do
          if [ -d "/proc/$pid" ]; then
            cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
          else
            # macOS doesn't have /proc, use lsof instead
            cwd=$(lsof -p "$pid" 2>/dev/null | grep cwd | awk '{print $NF}' || true)
          fi
          if [[ "$cwd" == "$path"* ]]; then
            claude_running=true
            break
          fi
        done
      fi

      if [ "$claude_running" = true ]; then
        echo -e "${CYAN}│${NC} ${GREEN}Claude: Running${NC}"
      else
        echo -e "${CYAN}│${NC} ${DIM}Claude:${NC} Not running"
      fi
    fi

    echo -e "${CYAN}└─────────────────────────────────────────────────────────────┘${NC}"
    echo ""
  fi
done <<< "$worktrees"

# Show Cyrus worktrees if any exist
cyrus_base="$HOME/.cyrus/workspaces/$REPO_NAME"
if [ -d "$cyrus_base" ]; then
  cyrus_count=$(ls -1 "$cyrus_base" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$cyrus_count" -gt 0 ]; then
    echo -e "${YELLOW}Also found $cyrus_count Cyrus worktree(s) in ~/.cyrus/workspaces/$REPO_NAME${NC}"
    echo -e "${DIM}Run './scripts/cyrus-status.sh' for Cyrus details${NC}"
    echo ""
  fi
fi

# Quick commands reference
echo -e "${DIM}─────────────────────────────────────────────────────────────────${NC}"
echo -e "${DIM}Quick commands:${NC}"
echo -e "  ${CYAN}./scripts/worktree-claude.sh resume <branch>${NC}  - Open Claude in worktree"
echo -e "  ${CYAN}./scripts/worktree-claude.sh cleanup <branch>${NC} - Remove worktree"
echo -e "  ${CYAN}./scripts/worktree-claude.sh cleanup-all${NC}      - Remove all worktrees"
echo ""

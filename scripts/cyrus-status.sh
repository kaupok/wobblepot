#!/bin/bash
# Check Cyrus agent status and active worktrees
#
# Usage: ./scripts/cyrus-status.sh
#
# Shows:
# - Active Cyrus worktrees
# - Configuration status
# - Recent Linear issue assignments

echo "🤖 Cyrus Agent Status"
echo "===================="
echo ""

# Check if config exists
if [ -f ~/.cyrus/config.json ]; then
  echo "✅ Configuration: ~/.cyrus/config.json exists"
else
  echo "❌ Configuration: Not found (run 'cyrus' to set up)"
  exit 1
fi

echo ""
echo "📁 Active Cyrus Worktrees:"
echo "--------------------------"

# List Cyrus-related worktrees
WORKTREES=$(git worktree list | grep -i cyrus || echo "")

if [ -z "$WORKTREES" ]; then
  echo "No active Cyrus worktrees found."
else
  echo "$WORKTREES"
fi

echo ""
echo "🔧 Useful Commands:"
echo "-------------------"
echo "  Start Cyrus:        ./scripts/cyrus-start.sh"
echo "  List all worktrees: git worktree list"
echo "  Remove worktree:    git worktree remove <path>"
echo "  Edit config:        vi ~/.cyrus/config.json"
echo ""

#!/bin/bash
# Start Cyrus agent to monitor and process Linear issues
#
# Usage: ./scripts/cyrus-start.sh
#
# Cyrus will:
# - Monitor Linear for issues assigned to the Cyrus bot
# - Create isolated git worktrees for each issue
# - Process issues using Claude Code
# - Post results back to Linear as comments

set -e

echo "🤖 Starting Cyrus agent..."
echo ""
echo "Cyrus will monitor Linear for assigned issues."
echo "Press Ctrl+C to stop."
echo ""

# Check if config exists
if [ ! -f ~/.cyrus/config.json ]; then
  echo "❌ Cyrus configuration not found!"
  echo ""
  echo "Please run 'cyrus' first to complete initial setup:"
  echo "  1. Connect your Linear workspace via OAuth"
  echo "  2. Configure repository settings"
  echo ""
  exit 1
fi

# Start Cyrus
cyrus

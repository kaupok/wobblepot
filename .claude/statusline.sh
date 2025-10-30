#!/bin/bash

# Claude Code Status Line Script
# Shows: model | branch
# Dependencies: jq

# Check for required dependencies
check_dependencies() {
  if ! command -v jq &> /dev/null; then
    echo "Error: Missing required utility: jq" >&2
    echo "Install with: brew install jq" >&2
    return 1
  fi
}

check_dependencies || exit 1

input=$(cat)

# Extract data from JSON input
MODEL=$(echo "$input" | jq -r '.model.display_name // "unknown"')

# Get current git branch
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "no-git")

# Build status line with color codes
# Model (cyan) | Branch (green)
echo -e "\033[36m$MODEL\033[0m | \033[32m$BRANCH\033[0m"

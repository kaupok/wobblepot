#!/bin/bash

# Claude Code Status Line Script
# Shows: model | branch | cost | repo | auth_method
# Dependencies: jq, bc

# Check for required dependencies
check_dependencies() {
  local missing=()

  if ! command -v jq &> /dev/null; then
    missing+=("jq")
  fi

  if ! command -v bc &> /dev/null; then
    missing+=("bc")
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    echo "Error: Missing required utilities: ${missing[*]}" >&2
    echo "Install with: brew install ${missing[*]}" >&2
    return 1
  fi
}

check_dependencies || exit 1

input=$(cat)

# Extract data from JSON input
MODEL=$(echo "$input" | jq -r '.model.display_name // "unknown"')
COST=$(echo "$input" | jq -r '.total_cost_usd // 0')
REPO=$(echo "$input" | jq -r '(.workspace.project_dir // ".") | split("/") | .[-1]')

# Get current git branch
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "no-git")

# Detect authentication method
detect_auth() {
  # Check for API keys first
  if [ -n "$LINEAR_API_KEY" ]; then
    echo "API/key"
  elif [ -n "$GITHUB_PERSONAL_ACCESS_TOKEN" ]; then
    echo "API/key"
  else
    # Default to OAuth/subscription if no API keys detected
    echo "OAuth"
  fi
}

AUTH=$(detect_auth)

# Format cost (show 0 if less than $0.01)
if (( $(echo "$COST < 0.01" | bc -l) )); then
  COST_STR="\$0"
else
  COST_STR=$(printf "\$%.2f" "$COST")
fi

# Build status line with color codes
# Model (cyan) | Branch (green) | Cost (yellow) | Repo (blue) | Auth (magenta)
echo -e "\033[36m$MODEL\033[0m | \033[32m$BRANCH\033[0m | \033[33m$COST_STR\033[0m | \033[34m$REPO\033[0m | \033[35m$AUTH\033[0m"

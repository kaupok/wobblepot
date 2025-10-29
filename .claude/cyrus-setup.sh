#!/bin/bash
# Cyrus Worktree Setup Script
#
# ⚠️  IMPORTANT: This script requires manual execution or higher Cyrus permission mode
#
# Current safe mode configuration blocks bash execution, so Cyrus cannot run this
# script automatically. You must either:
# 1. Manually run this script after Cyrus creates the worktree, OR
# 2. Switch Cyrus to a higher permission mode (with appropriate security review)
#
# Available environment variables:
# - LINEAR_ISSUE_IDENTIFIER (e.g., HON-123)
# - LINEAR_ISSUE_TITLE (e.g., "Fix authentication bug")
# - CYRUS_REPO_PATH (path to the worktree)

set -e

# Validate that pnpm is available
if ! command -v pnpm &> /dev/null; then
  echo "❌ Error: pnpm not found"
  echo "Please install pnpm first: npm install -g pnpm"
  exit 1
fi

echo "🚀 Setting up Cyrus worktree for ${LINEAR_ISSUE_IDENTIFIER:-[unknown issue]}: ${LINEAR_ISSUE_TITLE:-[unknown title]}"

# Note: These commands won't run automatically in safe mode
# You'll need to run them manually in the worktree directory

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Generate Prisma client (in case schema changed)
echo "🔧 Generating Prisma client..."
pnpm db:generate

# Run development environment health check
echo "🏥 Running health check..."
if [ -f "./scripts/health-check.sh" ]; then
  ./scripts/health-check.sh || echo "⚠️  Health check found warnings - continuing anyway"
else
  echo "⚠️  Health check script not found - skipping"
fi

echo "✅ Worktree setup complete for ${LINEAR_ISSUE_IDENTIFIER:-[unknown issue]}"

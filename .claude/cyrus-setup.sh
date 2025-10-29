#!/bin/bash
# Cyrus Worktree Setup Script
# Runs automatically when Cyrus creates a new worktree for a Linear issue
#
# Available environment variables:
# - LINEAR_ISSUE_IDENTIFIER (e.g., HON-123)
# - LINEAR_ISSUE_TITLE (e.g., "Fix authentication bug")
# - CYRUS_REPO_PATH (path to the worktree)

set -e

echo "🚀 Setting up Cyrus worktree for ${LINEAR_ISSUE_IDENTIFIER}: ${LINEAR_ISSUE_TITLE}"

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

echo "✅ Worktree setup complete for ${LINEAR_ISSUE_IDENTIFIER}"

#!/bin/bash
# Cyrus Worktree Setup Script
#
# This script sets up a fresh worktree for Cyrus to work on a Linear issue.
# It runs automatically when Cyrus creates a new worktree (permission presets allow it).
#
# What this script does:
# 1. Installs dependencies (pnpm install)
# 2. Generates Prisma client (required for TypeScript type checking)
# 3. Runs health check to validate the environment
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

# Install dependencies (includes postinstall hook that generates Prisma client)
echo "📦 Installing dependencies..."
pnpm install

# Generate Prisma client explicitly (redundant with postinstall but ensures it's available)
# This is a safety check in case postinstall fails silently or the schema was updated
echo "🔧 Generating Prisma client..."
pnpm db:generate

# Run development environment health check
echo "🏥 Running health check..."
if [ -f "./scripts/health-check.sh" ]; then
  # Temporarily disable exit on error to capture health check exit code
  set +e
  ./scripts/health-check.sh
  EXIT_CODE=$?
  set -e

  if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Health check passed - worktree is ready for development"
  elif [ $EXIT_CODE -eq 2 ]; then
    echo "⚠️  Health check completed with warnings (exit code: $EXIT_CODE)"
    echo "Review the warnings above - they may not block development but should be addressed."
  else
    echo "❌ Health check failed with errors (exit code: $EXIT_CODE)"
    echo ""
    echo "Common fixes:"
    echo "  • Missing dependencies: pnpm install"
    echo "  • Prisma client issues: pnpm db:generate"
    echo "  • TypeScript errors: Check type-check output above"
    echo ""
    echo "Review the full error output above for specific issues."
    exit 1
  fi
else
  echo "⚠️  Health check script not found - skipping"
fi

echo "✅ Worktree setup complete for ${LINEAR_ISSUE_IDENTIFIER:-[unknown issue]}"

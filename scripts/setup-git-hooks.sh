#!/bin/bash
#
# DEPRECATED: This script is no longer needed.
#
# Git hooks are now managed by Husky and install automatically when you run:
#   pnpm install
#
# The hook configuration lives in .husky/pre-commit
#
# This script remains for reference but should not be used.
#

echo "This script is deprecated."
echo ""
echo "Git hooks are now managed by Husky and install automatically on 'pnpm install'."
echo "If hooks aren't working, try: rm -rf .git/hooks/pre-commit && pnpm install"
echo ""
exit 0

# --- DEPRECATED CODE BELOW ---
# Setup script for git hooks
# Run this after cloning the repository to install recommended git hooks
#
# Usage: ./scripts/setup-git-hooks.sh

set -e

echo "🔧 Setting up git hooks..."
echo ""

HOOKS_DIR=".git/hooks"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Check if .git directory exists
if [ ! -d "$PROJECT_ROOT/.git" ]; then
  echo "❌ Error: .git directory not found. Are you in a git repository?"
  exit 1
fi

# Create pre-commit hook to prevent commits to main and run quality checks
echo "📝 Installing pre-commit hook (prevents commits to main + runs quality checks)..."

cat > "$PROJECT_ROOT/$HOOKS_DIR/pre-commit" << 'EOF'
#!/bin/sh
#
# Git pre-commit hook to prevent direct commits to main branch
# and run quality checks before committing
#
# This hook is NOT tracked in version control (.git/hooks/ is gitignored)
#
# Installation: This file should be in .git/hooks/pre-commit with execute permissions
# If you need to bypass this hook temporarily: git commit --no-verify

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the current branch name
branch=$(git symbolic-ref HEAD | sed -e 's,.*/\(.*\),\1,')

# Check if we're on the main branch
if [ "$branch" = "main" ]; then
  echo ""
  echo "${RED}❌ ERROR: Direct commits to main branch are not allowed!${NC}"
  echo ""
  echo "The main branch is protected. Please create a feature branch instead:"
  echo ""
  echo "  git checkout -b feat/your-feature-name"
  echo ""
  echo "See CLAUDE.md → Git Branch Workflow for more information."
  echo ""
  echo "If you absolutely need to commit to main (not recommended):"
  echo "  git commit --no-verify"
  echo ""
  exit 1
fi

# Run quality checks
echo ""
echo "${YELLOW}Running pre-commit checks...${NC}"
echo ""

# Run linter
echo "${YELLOW}[1/3] Running linter...${NC}"
if ! pnpm lint; then
  echo ""
  echo "${RED}❌ Lint failed! Please fix the errors before committing.${NC}"
  echo ""
  echo "To bypass this check (not recommended):"
  echo "  git commit --no-verify"
  echo ""
  exit 1
fi

# Run type check
echo ""
echo "${YELLOW}[2/3] Running type check...${NC}"
if ! pnpm type-check; then
  echo ""
  echo "${RED}❌ Type check failed! Please fix the errors before committing.${NC}"
  echo ""
  echo "To bypass this check (not recommended):"
  echo "  git commit --no-verify"
  echo ""
  exit 1
fi

# Run tests
echo ""
echo "${YELLOW}[3/3] Running tests...${NC}"
if ! pnpm test; then
  echo ""
  echo "${RED}❌ Tests failed! Please fix the errors before committing.${NC}"
  echo ""
  echo "To bypass this check (not recommended):"
  echo "  git commit --no-verify"
  echo ""
  exit 1
fi

echo ""
echo "${GREEN}✅ All checks passed! Proceeding with commit...${NC}"
echo ""

# Allow commits on all other branches
exit 0
EOF

chmod +x "$PROJECT_ROOT/$HOOKS_DIR/pre-commit"

echo "✅ pre-commit hook installed"
echo ""
echo "🎉 Git hooks setup complete!"
echo ""
echo "The following hooks are now active:"
echo "  • pre-commit: Prevents direct commits to main branch + runs lint/typecheck/tests"
echo ""
echo "To bypass hooks temporarily: git commit --no-verify"
echo ""
echo "⚠️  Note: The pre-commit hook will run all tests before committing."
echo "    This ensures code quality but may take a few seconds."
echo ""

#!/bin/bash
#
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

# Create pre-commit hook to prevent commits to main
echo "📝 Installing pre-commit hook (prevents commits to main)..."

cat > "$PROJECT_ROOT/$HOOKS_DIR/pre-commit" << 'EOF'
#!/bin/sh
#
# Git pre-commit hook to prevent direct commits to main branch
#

# Get the current branch name
branch=$(git symbolic-ref HEAD | sed -e 's,.*/\(.*\),\1,')

# Check if we're on the main branch
if [ "$branch" = "main" ]; then
  echo ""
  echo "❌ ERROR: Direct commits to main branch are not allowed!"
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

# Allow commits on all other branches
exit 0
EOF

chmod +x "$PROJECT_ROOT/$HOOKS_DIR/pre-commit"

echo "✅ pre-commit hook installed"
echo ""
echo "🎉 Git hooks setup complete!"
echo ""
echo "The following hooks are now active:"
echo "  • pre-commit: Prevents direct commits to main branch"
echo ""
echo "To bypass a hook temporarily: git commit --no-verify"
echo ""

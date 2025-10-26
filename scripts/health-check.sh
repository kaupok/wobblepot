#!/bin/bash
#
# Development environment health check
# Validates all required tools, environment variables, and MCP servers
#
# Usage: ./scripts/health-check.sh

set -e

echo "🏥 Running development environment health check..."
echo ""

ERRORS=0
WARNINGS=0

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
error() {
  echo -e "${RED}❌ ERROR: $1${NC}"
  ((ERRORS++))
}

warning() {
  echo -e "${YELLOW}⚠️  WARNING: $1${NC}"
  ((WARNINGS++))
}

success() {
  echo -e "${GREEN}✅ $1${NC}"
}

info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

echo "📋 Checking required tools..."
echo ""

# Check Node.js
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version)
  success "Node.js installed: $NODE_VERSION"
  if [[ ! "$NODE_VERSION" =~ ^v22\. ]]; then
    warning "Expected Node.js v22.x, got $NODE_VERSION"
  fi
else
  error "Node.js not installed"
fi

# Check pnpm
if command -v pnpm &> /dev/null; then
  PNPM_VERSION=$(pnpm --version)
  success "pnpm installed: $PNPM_VERSION"
else
  error "pnpm not installed. Install with: npm install -g pnpm"
fi

# Check Claude Code CLI
if command -v claude &> /dev/null; then
  success "Claude Code CLI installed"
else
  warning "Claude Code CLI not found in PATH"
fi

# Check git
if command -v git &> /dev/null; then
  success "Git installed: $(git --version)"
else
  error "Git not installed"
fi

echo ""
echo "📁 Checking project structure..."
echo ""

# Check if we're in git repo
if [ -d ".git" ]; then
  success "Git repository detected"

  # Check git hooks
  if [ -f ".git/hooks/pre-commit" ]; then
    success "Git pre-commit hook installed"
  else
    warning "Git pre-commit hook not installed. Run: ./scripts/setup-git-hooks.sh"
  fi
else
  error "Not in a git repository"
fi

# Check for required files
REQUIRED_FILES=("package.json" "tsconfig.json" ".env.example" "CLAUDE.md" ".mcp.json")
for file in "${REQUIRED_FILES[@]}"; do
  if [ -f "$file" ]; then
    success "Found $file"
  else
    error "Missing required file: $file"
  fi
done

echo ""
echo "🔐 Checking environment variables..."
echo ""

# Check for .env file
if [ -f ".env" ]; then
  success ".env file exists"

  # Check required env vars
  source .env 2>/dev/null || true

  if [ -n "$BETTER_AUTH_SECRET" ]; then
    success "BETTER_AUTH_SECRET is set"
  else
    error "BETTER_AUTH_SECRET not set in .env"
  fi

  if [ -n "$DATABASE_URL" ]; then
    success "DATABASE_URL is set"
  else
    error "DATABASE_URL not set in .env"
  fi

  if [ -n "$DATABASE_URL_UNPOOLED" ]; then
    success "DATABASE_URL_UNPOOLED is set"
  else
    warning "DATABASE_URL_UNPOOLED not set (required for migrations)"
  fi

  if [ -n "$GITHUB_PERSONAL_ACCESS_TOKEN" ]; then
    success "GITHUB_PERSONAL_ACCESS_TOKEN is set (for GitHub MCP)"
  else
    info "GITHUB_PERSONAL_ACCESS_TOKEN not set (optional - needed for GitHub MCP server)"
  fi
else
  error ".env file not found. Copy from .env.example: cp .env.example .env"
fi

echo ""
echo "📦 Checking dependencies..."
echo ""

if [ -d "node_modules" ]; then
  success "node_modules exists"
else
  warning "node_modules not found. Run: pnpm install"
fi

# Check if dependencies are up to date
if [ -f "pnpm-lock.yaml" ]; then
  if pnpm install --frozen-lockfile --dry-run &> /dev/null; then
    success "Dependencies are up to date"
  else
    warning "Dependencies may be out of sync. Run: pnpm install"
  fi
fi

echo ""
echo "🧪 Running quick checks..."
echo ""

# Check TypeScript compilation
if pnpm type-check &> /dev/null; then
  success "TypeScript compilation passed"
else
  error "TypeScript compilation failed. Run: pnpm type-check"
fi

# Check linting
if pnpm lint &> /dev/null; then
  success "Linting passed"
else
  warning "Linting issues found. Run: pnpm lint"
fi

echo ""
echo "🔌 Checking MCP servers..."
echo ""

if command -v claude &> /dev/null; then
  # Get MCP server status
  info "To check MCP server status manually, run: claude mcp list"
  success "MCP configuration available in .mcp.json"
else
  warning "Cannot check MCP servers (Claude Code CLI not in PATH)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo -e "${GREEN}🎉 All checks passed! Your development environment is healthy.${NC}"
  exit 0
elif [ $ERRORS -eq 0 ]; then
  echo -e "${YELLOW}⚠️  Health check completed with $WARNINGS warning(s).${NC}"
  echo "Your environment should work, but some optional features may be unavailable."
  exit 0
else
  echo -e "${RED}❌ Health check failed with $ERRORS error(s) and $WARNINGS warning(s).${NC}"
  echo "Please fix the errors above before continuing development."
  exit 1
fi

# Honkadori

A modern Next.js 15 application with React 19, TypeScript, and Better Auth authentication.

## Quick Start

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Edit .env and fill in required values

# Run development server
pnpm dev

# Open http://localhost:3000
```

## Tech Stack

- **Framework**: Next.js 15.5.3 with Turbopack
- **Language**: TypeScript 5.9
- **Styling**: Tailwind CSS 4.1 + shadcn/ui
- **Database**: PostgreSQL (Neon) with Prisma ORM
- **Authentication**: Better Auth
- **Testing**: Vitest + Playwright
- **Package Manager**: pnpm 10.9

## Project Structure

```
/app              - Next.js App Router (routes, layouts, pages)
/components       - Reusable UI components
  /ui             - shadcn/ui primitives
/lib              - Shared utilities and configuration
/hooks            - Custom React hooks
/prisma           - Database schema and migrations
/e2e              - Playwright E2E tests
/docs             - Detailed documentation
/scripts          - Automation scripts
/.claude          - Claude Code configuration
```

## Documentation

- **[CLAUDE.md](CLAUDE.md)** - Coding guidelines for AI-assisted development (optimized for Claude Code)
- **[docs/](docs/)** - Comprehensive documentation for human contributors
  - [Deployment](docs/DEPLOYMENT.md) - Staging and production deployment
  - [Git Workflow](docs/GIT_WORKFLOW.md) - Branching, commits, and PRs
  - [Environment Setup](docs/ENVIRONMENT_SETUP.md) - Environment variables
  - [MCP Setup](docs/MCP_SETUP.md) - Model Context Protocol configuration
  - [Performance](docs/PERFORMANCE.md) - Bundle optimization
  - [Cyrus Guide](docs/CYRUS_GUIDE.md) - AI agent integration

## Development

```bash
# Development server
pnpm dev

# Linting
pnpm lint
pnpm lint --fix

# Type checking
pnpm type-check

# Testing
pnpm test              # Unit tests
pnpm test:coverage     # With coverage
pnpm test:e2e          # End-to-end tests
pnpm test:all          # All tests

# Database
pnpm db:studio         # Open Prisma Studio
pnpm db:migrate        # Create and apply migration
pnpm db:push           # Push schema without migration
pnpm db:generate       # Regenerate Prisma Client

# Build
pnpm build             # Production build
```

## Getting Started

1. **Clone and install:**

   ```bash
   git clone <repository-url>
   cd honkadori
   pnpm install
   ```

2. **Set up environment:**

   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Set up database:**

   ```bash
   pnpm db:push
   ```

4. **Install git hooks:**

   ```bash
   ./scripts/setup-git-hooks.sh
   ```

5. **Run health check:**

   ```bash
   ./scripts/health-check.sh
   ```

6. **Start developing:**
   ```bash
   pnpm dev
   ```

## Contributing

1. **Never commit directly to `main`** - Always use feature branches
2. **Branch naming**: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`
3. **Commit format**: Follow [Conventional Commits](https://www.conventionalcommits.org/)
4. **Before committing**: Run `pnpm lint && pnpm type-check && pnpm test`
5. **Create PR**: Use descriptive titles following Conventional Commits format

See [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md) for detailed workflow.

## AI-Assisted Development

This project is optimized for AI-assisted development with Claude Code:

- **CLAUDE.md**: Concise coding guidelines for Claude
- **MCP Servers**: Enhanced capabilities via Model Context Protocol
- **Templates**: Component and test templates (`.claude/templates/`)
- **Cyrus Integration**: Autonomous AI agent for Linear issue processing

See [docs/MCP_SETUP.md](docs/MCP_SETUP.md) for setup.

## License

[Add your license here]

## Support

For issues and questions:

- Check the [documentation](docs/)
- Review [CLAUDE.md](CLAUDE.md) for coding patterns
- Run `./scripts/health-check.sh` for environment validation

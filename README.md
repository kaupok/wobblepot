# Honkadori

AI-powered weekly meal planning for families. Generates personalized ingredient-based meal plans with nutritional transparency, shopping lists, and pantry tracking.

## Getting Started

```bash
pnpm install
cp .env.example .env   # Edit with your values
pnpm db:push
pnpm dev               # http://localhost:3000
```

See [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md) for environment variable details.

## Tech Stack

- **Framework**: Next.js 16 / React 19 / TypeScript 5.9
- **Styling**: Tailwind CSS 4.1 + shadcn/ui
- **Database**: PostgreSQL (Neon) + Prisma ORM
- **Auth**: Better Auth
- **Testing**: Vitest + Playwright
- **Package Manager**: pnpm 10.9

## Development

```bash
pnpm dev               # Development server
pnpm lint              # Linting
pnpm type-check        # Type checking
pnpm test              # Unit tests
pnpm test:e2e          # E2E tests
pnpm db:studio         # Prisma Studio GUI
pnpm db:migrate        # Create and apply migration
```

Always run `pnpm lint && pnpm type-check && pnpm test` before committing. Never commit directly to `main` - use feature branches. See [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md) for the full workflow.

## Documentation

| Document                                               | Contents                                      |
| ------------------------------------------------------ | --------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                                 | Coding guidelines (optimized for Claude Code) |
| [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md)           | Product vision, decisions, domain logic       |
| [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)           | Branching, commits, PRs                       |
| [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md) | Environment variables                         |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)               | Staging and production deployment             |
| [docs/TYPOGRAPHY.md](docs/TYPOGRAPHY.md)               | Typography component guide                    |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md)             | Bundle optimization                           |
| [docs/MCP_SETUP.md](docs/MCP_SETUP.md)                 | MCP server configuration                      |
| [docs/PARALLEL_WORKFLOW.md](docs/PARALLEL_WORKFLOW.md) | Parallel Claude Code with git worktrees       |
| [docs/CHROME_TESTING.md](docs/CHROME_TESTING.md)       | Browser testing with Chrome extension         |

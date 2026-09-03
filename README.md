# Wobblepot

AI-powered weekly meal planning for families. Wobblepot builds a household's week of meals around what the family likes and what is already in the pantry, then turns the plan into a shopping list with nutrition you can actually read. It is live at [wobblepot.com](https://wobblepot.com).

This is the production codebase, published for transparency and as a working example of an agent-driven engineering process. It is not an open-source project: all rights reserved, and pull requests are not accepted. Reading, learning from, and asking about it are all welcome.

The product brand is Wobblepot. Honkadori OÜ is the legal entity behind it, and "Honkadori" appears only in legal text and internal identifiers such as the package name, the Linear workspace, and vendor accounts.

## What is worth looking at

Most of this repository is an ordinary Next.js application. The parts that are less ordinary:

### Agent-driven development

Nearly every change here was planned, implemented, reviewed, and merged by Claude Code working from Linear issues, with a human deciding what to build and reviewing what shipped.

- [`CLAUDE.md`](CLAUDE.md) is the operating manual the agent reads every session: coding patterns, the definition of done, and rules learned from things that went wrong. Many of its "CRITICAL" lines are scar tissue from a specific incident, referenced by issue number.
- [`.claude/skills/`](.claude/skills/) holds the sixteen project skills that make up the workflow: `next-issue` → `plan-issue` → `implement-issue` → `branch-review` → `commit --pr` → `triage-pr-comments` → `merge`. `auto-implement` runs the whole cycle unattended for one issue.
- [`scripts/orchestrator.sh`](scripts/orchestrator.sh) polls Linear for ready issues and spawns one worker per issue, each in its own git worktree with its own Neon database branch. [`docs/PARALLEL_WORKFLOW.md`](docs/PARALLEL_WORKFLOW.md) explains the model; [`scripts/worktree-claude.sh`](scripts/worktree-claude.sh) is the `wt` entry point.
- [`scripts/pr-review.sh`](scripts/pr-review.sh) posts a Claude review on every pull request opened through the workflow. The same skills then triage the comments and address the ones that matter, and the merge skill runs the review first if a PR was opened by hand, so nothing merges unreviewed.

### Quality gates

- **Storybook with an accessibility gate.** Over eighty colocated story files run through axe in CI, and modal stories carry play functions that assert focus trapping, Escape handling, and tab order. Browse the published build at [kaupok.github.io/wobblepot](https://kaupok.github.io/wobblepot/), rebuilt from `main` whenever a merge touches the stories or their inputs. See [`.storybook/README.md`](.storybook/README.md).
- **Tests at three levels.** Around two hundred colocated Vitest files, plus Playwright specs in three tiers: the core suite on every push, smoke runs against Vercel preview deployments on labelled PRs, and a staging smoke run that gates promotion to production. See [`tests/e2e/README.md`](tests/e2e/README.md).
- **Environment drift audit.** A blocking CI step diffs the Vercel environment against the variables the code actually reads, so dead or missing configuration fails the build. See [`scripts/env-audit.ts`](scripts/env-audit.ts).
- **Pre-commit checks.** Type-check, ESLint, and Prettier run on staged files through Husky and lint-staged.

### Privacy and compliance

Built to run in the EU under GDPR from the first user, with the paperwork in the repository rather than in a drawer.

- [`docs/RUNBOOKS/`](docs/RUNBOOKS/): breach notification, data subject request intake, account deletion, database recovery, Neon branch cleanup, and the public status page.
- Grace-window account deletion with a scheduled purge, and a data-export endpoint for portability.
- [`compliance/`](compliance/): the subprocessor register and vendor data-processing agreements. Executed contracts that carry signatory details stay out of the tree.
- Cookie consent that gates analytics, and a public subprocessor page inside the app.

### Localization

Estonian is the first non-English locale. [`docs/LOCALIZATION.md`](docs/LOCALIZATION.md) describes a three-tier model: AI-generated content gets prompt work and voice judgment, domain content gets translation with native review, and UI chrome gets externalized and translated in volume. The interesting decision is treating the AI's voice as the highest-leverage surface, because most of what a family reads over time is generated, not seeded.

### Feature flags and security headers

- PostHog-backed kill-switches that fail open, so an outage of the flag service never takes the product down. See [`docs/FEATURE_FLAGS.md`](docs/FEATURE_FLAGS.md).
- A Content Security Policy with per-request nonces and `strict-dynamic`, plus HSTS, Referrer-Policy, and Permissions-Policy. See [`docs/SECURITY.md`](docs/SECURITY.md).

## Stack

| Layer               | Choice                                     |
| ------------------- | ------------------------------------------ |
| Framework           | Next.js 16, React 19, TypeScript 5.9       |
| UI                  | Tailwind CSS 4, shadcn/ui, Storybook 10    |
| Data                | PostgreSQL on Neon, Prisma 7               |
| Client state        | TanStack Query 5                           |
| Auth                | Better Auth, email and password            |
| AI                  | Anthropic Claude through the Vercel AI SDK |
| Localization        | next-intl                                  |
| Analytics and flags | PostHog, EU region                         |
| Email               | Resend                                     |
| Rate limiting       | Upstash Redis                              |
| Hosting             | Vercel                                     |
| Tests               | Vitest, Playwright, Storybook with axe     |

## Running it locally

You can, but this is a production application with real vendor dependencies rather than a demo. A full local run needs a PostgreSQL database, an Anthropic API key, and, for the features that use them, Resend and Upstash accounts. [`src/lib/env.ts`](src/lib/env.ts) is the authoritative list of every variable and which ones are optional; [`docs/ENVIRONMENT_SETUP.md`](docs/ENVIRONMENT_SETUP.md) covers the vendor setup behind them.

```bash
pnpm install
cp .env.example .env    # at minimum: DATABASE_URL, DATABASE_URL_UNPOOLED, BETTER_AUTH_SECRET, ANTHROPIC_API_KEY
pnpm db:push            # Prisma CLI commands read DATABASE_URL_UNPOOLED; the app reads DATABASE_URL
pnpm db:seed
pnpm dev                # http://localhost:3000
```

Useful commands once it runs:

```bash
pnpm lint && pnpm type-check && pnpm test   # the pre-commit bar
pnpm test:e2e:local                         # Playwright on a throwaway Neon branch (needs NEON_API_KEY)
pnpm storybook                              # component workbench on port 6006
pnpm test-storybook:ci                      # every story through axe, once
pnpm db:studio                              # Prisma Studio
```

## Documentation

| Document                                               | Contents                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| [CLAUDE.md](CLAUDE.md)                                 | Coding guidelines and the agent's operating rules            |
| [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md)           | Product vision, decisions, domain logic                      |
| [docs/PARALLEL_WORKFLOW.md](docs/PARALLEL_WORKFLOW.md) | Parallel Claude Code with git worktrees and the orchestrator |
| [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)           | Branching, commits, PRs, recovery                            |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)               | Staging and production deployment                            |
| [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md) | Environment variables                                        |
| [docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md)             | Transactional email and deliverability                       |
| [docs/FEATURE_FLAGS.md](docs/FEATURE_FLAGS.md)         | Feature flags, kill-switches, fail-open semantics            |
| [docs/LOCALIZATION.md](docs/LOCALIZATION.md)           | Localization philosophy and the three-tier model             |
| [docs/SECURITY.md](docs/SECURITY.md)                   | Security headers and CSP                                     |
| [docs/RUNBOOKS/](docs/RUNBOOKS/)                       | Operational runbooks, GDPR procedures                        |
| [docs/TYPOGRAPHY.md](docs/TYPOGRAPHY.md)               | Typography component guide                                   |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md)             | Bundle optimization                                          |
| [docs/MCP_SETUP.md](docs/MCP_SETUP.md)                 | MCP server configuration for the agent                       |
| [docs/CHROME_TESTING.md](docs/CHROME_TESTING.md)       | Browser testing with the Chrome extension                    |
| [docs/VOICE_REVIEW.md](docs/VOICE_REVIEW.md)           | Voice-driven staging review                                  |

## Security

If you find a vulnerability, email [support@wobblepot.com](mailto:support@wobblepot.com) rather than opening a public issue. Privacy questions go to [privacy@wobblepot.com](mailto:privacy@wobblepot.com).

## License

All rights reserved. The source is published so the product and the process behind it can be inspected, not so it can be reused.

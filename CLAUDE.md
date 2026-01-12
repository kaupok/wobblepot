# Honkadori - Code Guidelines

In conversational responses, prioritize brevity. Keep explanations concise and direct.

## Table of Contents

- [Project Overview](#project-overview)
- [Documentation Structure](#documentation-structure)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [File Organization](#file-organization)
- [Authentication Patterns](#authentication-patterns)
- [Data Fetching Patterns](#data-fetching-patterns)
- [Error Handling Strategy](#error-handling-strategy)
- [Form Handling Patterns](#form-handling-patterns)
- [Code Standards](#code-standards)
  - [Typography Components](#typography-components)
- [Environment Variables](#environment-variables)
- [Database Patterns](#database-patterns)
- [Testing](#testing)
- [Performance & Optimization](#performance--optimization)
- [Review Focus](#review-focus)
- [Git Branch Workflow](#git-branch-workflow)
- [Linear Issue Workflow](#linear-issue-workflow)
- [Continue Implementation Workflow](#continue-implementation-workflow)
- [Skill-Based Development Workflow](#skill-based-development-workflow)
- [Subagent Patterns for Context Efficiency](#subagent-patterns-for-context-efficiency)
- [Pull Request Workflow](#pull-request-workflow)
- [CI Pipeline](#ci-pipeline)
- [Production Deployment Process](#production-deployment-process)
- [Commit Message Conventions](#commit-message-conventions)
- [MCP Server Configuration](#mcp-server-configuration)
  - [Permission Presets](#permission-presets)
  - [Development Environment Health Check](#development-environment-health-check)
- [Cyrus/Linear Integration](#cyruslinear-integration)
  - [What is Cyrus](#what-is-cyrus)
  - [Initial Setup](#initial-setup)
  - [Configuration](#configuration)
  - [Usage Workflow](#usage-workflow)
  - [Monitoring and Troubleshooting](#monitoring-and-troubleshooting)

## Project Overview

A Next.js 16 project with React 19, using TypeScript, Tailwind CSS, and shadcn/ui components.

**Product:** Family Meal Planning App (Honkadori) - AI-powered weekly meal planning for households.

**Product Spec:** The complete product specification is documented in the [Family Meal Planning App](https://linear.app/honkadori/project/family-meal-planning-app-694f025b60a4) Linear project (ID: `5a19627a-803f-4052-83c4-b44810d17af7`). This includes database schema, AI strategy, and MVP phases.

**IMPORTANT - Before Implementation:** Always fetch the project spec using the Linear MCP server before starting any implementation work:

```typescript
mcp__linear - server__get_project({ query: '5a19627a-803f-4052-83c4-b44810d17af7' })
```

This ensures you have the latest context on features, data models, and implementation decisions. The spec is the source of truth for architectural decisions.

## Documentation Structure

| Document                  | Contains                                             | When to Read                |
| ------------------------- | ---------------------------------------------------- | --------------------------- |
| **This file (CLAUDE.md)** | Coding patterns, workflows, technical setup          | Every session (auto-loaded) |
| **Linear Project Spec**   | Product vision, decisions, phase goals, domain logic | Before implementation work  |

**Rule:** CLAUDE.md tells you _how_ to code. Linear spec tells you _what_ to build and _why_.

**When to update each:**

- New feature → Linear spec (what), then CLAUDE.md (how) if new patterns needed
- Architecture decision → Linear spec (decision + rationale)
- New coding pattern → CLAUDE.md only

## Tech Stack

- **Framework**: Next.js 16.1.1
- **Language**: TypeScript 5.9
- **Styling**: Tailwind CSS 4.1 with class-variance-authority
- **Testing**: Vitest for unit tests, Playwright for E2E
- **Linting**: ESLint 9 + Prettier
- **Package Manager**: pnpm 10.9
- **Database**: PostgreSQL (Neon) with Prisma ORM
- **Authentication**: Better Auth

## Architecture Overview

### Directory Structure

- **/app**: Next.js App Router (routes, layouts, error boundaries)
- **/components**: Reusable UI components
  - `/ui`: shadcn/ui primitives (button, card, typography, input, label, etc.)
  - Root level: Feature components (header, theme-toggle, etc.)
- **/lib**: Shared utilities, configuration, and service clients
  - `auth.ts`: Server-side Better Auth instance
  - `auth-client.ts`: Client-side Better Auth instance
  - `env.ts`: Environment variable validation (Zod schemas)
  - `prisma.ts`: Prisma client singleton
  - `utils.ts`: Utility functions (cn, etc.)
- **/hooks**: Custom React hooks (useThemeColor, etc.)
- **/e2e**: Playwright E2E tests
- **/prisma**: Database schema and migrations

### Key Architectural Patterns

- **Server Components by default**: All page.tsx files are async Server Components unless they need interactivity
- **"use client" only when necessary**: Add the directive only for components that need:
  - Interactivity (onClick, onChange, etc.)
  - Browser APIs (localStorage, window, etc.)
  - React hooks (useState, useEffect, etc.)
- **Colocated tests**: Tests live next to their source files with `.test.tsx` or `.test.ts` suffix
- **Absolute imports**: Use `@/` prefix for all imports (configured via tsconfig paths)
- **Type-safe environment variables**: All env vars validated with Zod at startup (see `lib/env.ts:3`)

## File Organization

### Naming Conventions

- **Components**: PascalCase (`UserProfile.tsx`, `Header.tsx`, `ThemeToggle.tsx`)
- **Utilities**: camelCase (`formatDate.ts`, `utils.ts`)
- **Hooks**: camelCase with "use" prefix (`useAuth.ts`, `useThemeColor.ts`)
- **Tests**: Same name as source + `.test.ts(x)` suffix (`button.test.tsx`, `utils.test.ts`)

### Where to Put New Code

- **shadcn UI primitives** → `/components/ui` (generated via CLI, minimal customization)
- **Feature components** → `/components` root level (components used across multiple routes)
- **Route-specific components** → Colocate in `/app/[route]/` directory
- **Shared hooks** → `/hooks`
- **Utilities & config** → `/lib`
- **API routes** → `/app/api/[route]/route.ts`
- **Page routes** → `/app/[route-name]/page.tsx`

## Authentication Patterns

**Better Auth** for email/password authentication (no OAuth yet).

**Instances:**

- Server: `@/lib/auth` (Server Components, API routes)
- Client: `@/lib/auth-client` (Client Components)
- API: `/api/auth/[...all]` (handles all auth endpoints)

**Protected routes:** Check session with `auth.api.getSession({ headers: await headers() })`, redirect if null. See `src/app/profile/page.tsx:8-15`

**Client-side auth:** Use `authClient.signIn.email()` with `onSuccess`/`onError` callbacks. See `src/app/sign-in/page.tsx:59-74`

**Sign out:** Call `authClient.signOut()` + `router.push()` + `router.refresh()`

**Templates:** See `.claude/templates/auth-protected-route.tsx` and `.claude/templates/auth-form.tsx`

## Data Fetching Patterns

**Server Components (preferred):** Fetch data directly in async Server Components. Benefits: no loading states, better performance, SEO-friendly, automatic deduplication. See `src/app/page.tsx:8-11`

**Client Components:** Use native React `useState` for loading/error states. For auth mutations, use Better Auth client methods. See `src/app/sign-in/page.tsx:46-78`

**Note:** We use native patterns (no SWR/React Query).

## Error Handling Strategy

**Route-level error boundaries:** Next.js provides automatic error boundaries via `error.tsx`. Use Typography components (Heading, Body, Pre) for error UI. Show detailed errors only in development mode using `process.env.NODE_ENV`. See `src/app/error.tsx`

**User-friendly error messages:** Map technical errors to user-friendly messages. Example: "invalid credentials" → "The email or password you entered is incorrect." See `src/app/sign-in/page.tsx:23-44`

## Form Handling Patterns

**Native HTML forms** with controlled inputs (no form library).

**Pattern:** Use `useState` for form state, `onSubmit` handler with `e.preventDefault()`, disable inputs during submission. See `src/app/sign-in/page.tsx:46-141`

**Validation:** HTML5 (`required`, `type="email"`, `minLength`), custom validation in submit handler, server-side via Better Auth

**Template:** See `.claude/templates/auth-form.tsx`

## Code Standards

### TypeScript & Linting

- Strict TypeScript mode (`tsconfig.json`)
- ESLint rules enforced by CI
- Prettier formatting (run `pnpm format` before committing)
- Use `pnpm lint` to check for issues

### Dependency Management

- Use exact versions (no caret `^` or tilde `~`) for all dependencies
- Example: `"next": "15.5.3"` not `"^15.5.3"`
- This ensures consistent installations across all environments
- Update dependencies deliberately and test thoroughly

### Styling

- Tailwind CSS for styling
- shadcn/ui components for reusable components
- Use `tailwind-merge` for dynamic class merging
- Avoid inline styles; use Tailwind utilities

### Components & Hooks

- Functional components only (no class components)
- Use React hooks for state management
- Keep components focused and single-responsibility
- Use TypeScript types for props

### Text Casing Convention

Use **sentence case** for all UI text elements (buttons, headings, labels, links):

**DO:**

- Button text: "Sign in", "Sign up", "Sign out"
- Headings: "Create account", "View profile"
- Labels: "Email address", "Password"

**DON'T:**

- ❌ "Sign In", "Sign Up", "Sign Out" (Title Case)
- ❌ "SIGN IN" (ALL CAPS)

**Exception:** Single-word headings/labels don't change (e.g., "Profile", "Settings")

This applies to:

- Button text and loading states
- Page headings and card titles
- Form labels and descriptions
- Links and navigation text

### Typography Components

We use two main variant-based components for typography:

#### `Heading` Component

Renders semantic heading elements (h1-h4) with consistent styling:

```tsx
<Heading>Default (h1)</Heading>
<Heading variant="h2">Secondary heading</Heading>
<Heading variant="h3">Tertiary heading</Heading>
<Heading variant="h4">Quaternary heading</Heading>
```

**Available variants:** `h1` | `h2` | `h3` | `h4`

#### `Body` Component

Renders paragraph text with different text sizes and styles:

```tsx
<Body>Default body text</Body>
<Body variant="lead">Lead/intro text (larger, muted)</Body>
<Body variant="large">Large text (lg, semibold)</Body>
<Body variant="small">Small text (sm, medium weight)</Body>
<Body variant="muted">Muted text (sm, muted color)</Body>
```

**Available variants:** `default` | `lead` | `large` | `small` | `muted`

#### Separation of Concerns

**Text styling only** (in components):

- Font size, weight, color, line-height, tracking
- Components handle all text presentation concerns

**Layout concerns** (via wrapper elements):

- Margins, padding, display, positioning
- Apply layout classes to a wrapper `<div>` instead of directly on typography components

**Exceptions** - Built-in layout when essential:

- `Blockquote`: includes `pl-6` (padding needed for the border design to work correctly)
- `Ul`/`Ol`: include `my-6 ml-6` (vertical/horizontal spacing is intrinsic to list formatting; ml-6 for indentation, my-6 to match typographic rhythm of other block elements)
- `Pre`: includes `p-4` (padding needed for code block presentation and readability)

**Practical Guidelines:**

1. **When wrapping would create invalid HTML** (e.g., block elements in inline contexts):
   - Apply minimal spacing directly to the typography component
   - Example: `<Heading className="mb-4">Title</Heading>`

2. **When grouping related typography elements:**
   - Use a flex container with `gap` when all elements need uniform spacing
   - Use nested containers with individual spacing when different relationships need different gaps
   - Example with uniform spacing:

   ```tsx
   <div className="flex flex-col gap-3">
     <Heading variant="h2">Main heading</Heading>
     <Body>Primary description</Body>
   </div>
   ```

   - Example with varied spacing:

   ```tsx
   <div className="flex flex-col gap-6">
     <Heading variant="h2">Main heading</Heading>
     <div className="flex flex-col gap-2">
       <Body>Primary description</Body>
       <Body variant="small">Secondary note</Body>
     </div>
   </div>
   ```

**Example - DON'T:**

```tsx
<Body variant="muted" className="mb-6 block">
  Error ID: 12345
</Body>
```

#### Other Components

**`Blockquote`** - Semantic blockquote with left border and padding:

```tsx
<Blockquote>"This is a great quote that I found somewhere online."</Blockquote>
```

**`Ul`/`Ol`/`Li`** - Semantic lists with built-in spacing:

```tsx
<Ul>
  <Li>First item</Li>
  <Li>Second item</Li>
  <Li>Third item</Li>
</Ul>

<Ol>
  <Li>First step</Li>
  <Li>Second step</Li>
  <Li>Third step</Li>
</Ol>
```

**`Code`** - Inline code with styling:

```tsx
<Body>
  Use the <Code>npm install</Code> command to install dependencies.
</Body>
```

**`Pre`** - Code blocks with scrolling and padding:

```tsx
<div className="my-4">
  <Pre>
    {`function example() {
  return "Hello, world!";
}`}
  </Pre>
</div>
```

#### Custom Classes and Type Styling

All typography components accept a `className` prop that merges with component classes via the `cn()` utility. **However, only pass text-styling classes** (colors, sizes, weights, text-alignment) to maintain separation of concerns:

**DO - text styling classes:**

```tsx
<Pre className="text-destructive text-xs">Error details</Pre>
```

**DON'T - layout classes on component:**

```tsx
<Pre className="mt-2 mb-4">Error details</Pre>
```

**Instead - wrap with layout:**

```tsx
<div className="mt-2 mb-4">
  <Pre className="text-destructive text-xs">Error details</Pre>
</div>
```

## Environment Variables

Environment variables are validated at runtime using Zod (`src/lib/env.ts`).

**Usage in code:**

- Client-side: `import { clientEnv } from '@/lib/env'` (only `NEXT_PUBLIC_*` vars)
- Server-side: `import { serverEnv } from '@/lib/env'` (all vars)

**Setup and adding new variables:** See [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md)

## Database Patterns

**Prisma ORM** with **PostgreSQL** (Neon with connection pooling).

**Client:** `import { prisma } from '@/lib/prisma'` (server-only). See `src/lib/prisma.ts`

**Schema:** `prisma/schema.prisma` - Models include Better Auth (User, Session, Account, Verification) and meal planning (Household, HouseholdMember, Ingredient, Meal, MealComponent, MealPlan, MealPlanEntry, PantryItem, etc.)

**Commands:**

- `pnpm db:migrate` - Create and apply migration
- `pnpm db:studio` - Open Prisma Studio GUI
- `pnpm db:push` - Push schema without migration (dev only)
- `pnpm db:generate` - Regenerate Prisma Client
- `pnpm db:migrate:deploy` - Apply migrations (production)

**Adding models:** Edit schema → `pnpm db:migrate` → Commit schema + migration files

## Testing

**Unit/Component Tests** (Vitest + Testing Library): Colocate with source files using `.test.tsx` suffix. Use `describe`/`it`, accessibility queries (`getByRole`), focus on user-facing behavior. See `src/components/ui/button.test.tsx`

**Commands:** `pnpm test`, `pnpm test:coverage`, `pnpm test:e2e`, `pnpm test:all`

**What to test:** Component rendering, variants/states, user interactions, error handling, utility functions, custom hooks

**E2E Tests** (Playwright): Located in `/tests` or `/e2e`. Run with `pnpm test:e2e` (add `--headed` to see browser, `--debug` for debugging). Config: `playwright.config.ts`

**Playwright MCP:** AI can generate tests, debug failures, update selectors

## Performance & Optimization

Use `pnpm build` to analyze bundle size. Target: First Load JS < 200 kB.

**Key optimizations:** Dynamic imports, tree shaking, replacing large dependencies.

**Detailed guide:** See [docs/PERFORMANCE.md](docs/PERFORMANCE.md)

## Review Focus

- Flag actual bugs and logic errors
- Suggest improvements only if they have clear value
- Skip nitpicking on formatting (Prettier handles it)
- Ensure tests are meaningful and cover the changes
- Watch for TypeScript strictness violations

## Git Branch Workflow

**CRITICAL: Never commit directly to `main`.** Always use feature branches.

**Branch naming:** `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`

**Workflow:**

1. Check branch: `git branch --show-current` (must not be `main`)
2. Create branch: `git checkout -b feat/your-feature`
3. Make changes, run tests (`pnpm lint && pnpm type-check && pnpm test`)
4. Commit with Conventional Commits format
5. Push: `git push -u origin feat/your-feature`
6. Create PR: `gh pr create --title "type(scope): subject"`

**Pre-commit hook:** Husky + lint-staged auto-installs on `pnpm install`. Runs type-check, ESLint, and Prettier on staged files. Prevents commits to `main`.

**Detailed guide and recovery procedures:** See [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)

## Linear Issue Workflow

When working on Linear issues manually (not through Cyrus automation), follow these steps:

**1. Get issue details:**

```typescript
// Using Linear MCP server to fetch the issue
mcp__linear - server__get_issue({ id: 'HON-XX' })
```

Linear provides a `gitBranchName` field with a suggested branch name that automatically links the branch to the issue.

**2. Update issue status and assign yourself:**

Before starting implementation, update the Linear issue status and assign yourself if unassigned:

```typescript
// Using Linear MCP server
mcp__linear -
  server__update_issue({
    id: 'HON-XX',
    state: 'In progress',
    assignee: 'me', // Assign to yourself if unassigned
  })
```

This signals to the team that work has begun and who is working on it.

**3. Create branch using Linear's suggested name:**

Use the `gitBranchName` from the issue instead of creating a custom branch name:

```bash
# Example: If gitBranchName is "kaupokorv/hon-11-adjust-issue-status"
git checkout -b kaupokorv/hon-11-adjust-issue-status
```

This ensures the branch is automatically linked to the Linear issue.

**4. Work on the implementation:**

Follow normal development workflow (make changes, run tests, commit).

**5. Create PR:**

When creating the PR, the branch name will automatically link it to the Linear issue. Linear automation will then move the issue to "In review" status.

**Important:** Once a PR is created, do NOT update the Linear issue status manually. Linear automation handles status transitions from that point forward.

## Continue Implementation Workflow

When the user asks to "continue implementation" without specifying an issue:

**Preferred method:** Use `/next-issue` to efficiently find the next task.

The `/next-issue` skill runs in an isolated subagent that:

1. Queries Linear for backlog issues in the active milestone
2. Checks dependencies to find unblocked work
3. Does a quick codebase scan for key files
4. Returns a concise summary (~500 words)

This saves ~8k tokens compared to doing discovery in the main conversation.

**Manual workflow** (if `/next-issue` unavailable or more control needed):

**1. Fetch project context:**

```typescript
mcp__linear - server__get_project({ query: '5a19627a-803f-4052-83c4-b44810d17af7' })
```

Review the project description for current phase, active milestone, and any context needed.

**2. Find candidate issues:**

```typescript
mcp__linear -
  server__list_issues({
    project: '5a19627a-803f-4052-83c4-b44810d17af7',
    state: 'Backlog',
    limit: 20,
  })
```

**3. Check relationships for each candidate:**

For promising candidates (especially in the active milestone), fetch with relations:

```typescript
mcp__linear - server__get_issue({ id: 'HON-XX', includeRelations: true })
```

**4. Find unblocked issues:**

An issue is ready to work on if:

- `blockedBy` is empty, OR
- All issues in `blockedBy` have status "Done" or "Canceled"

**5. Prioritize by:**

1. Active milestone (check project description for current phase)
2. Dependency order (issues that unblock others first)
3. Logical sequence within the milestone

**6. Present recommendation:**

Show the recommended issue with:

- Why it's unblocked
- What it will unblock (from `blocks` relation)
- Brief summary of the implementation

## Skill-Based Development Workflow

The following skills provide a structured workflow for implementing Linear issues.

### Available Skills

| Skill                     | Purpose                                            | Context           |
| ------------------------- | -------------------------------------------------- | ----------------- |
| `/next-issue`             | Find next unblocked issue in active milestone      | Isolated          |
| `/plan-issue HON-XX`      | Create plan, post to Linear after approval         | Main conversation |
| `/implement-issue HON-XX` | Execute plan from Linear, create branch            | Main conversation |
| `/code-review`            | Review all changes on current branch               | Isolated          |
| `/triage-code-review`     | Categorize review findings into address/defer/skip | Main conversation |
| `/commit`                 | Stage changes, run checks, create commit           | Main conversation |
| `/pr`                     | Analyze commits, create pull request               | Main conversation |

### Typical Workflow

**1. Find next issue:**

```
/next-issue
```

Returns recommended issue with key files and implementation summary.

**2. Plan the implementation:**

```
/plan-issue HON-51
```

- Fetches issue details and project context
- Enters plan mode
- Creates comprehensive plan file
- User reviews and approves plan

**3. Implement:**

```
/implement-issue HON-51
```

- Posts approved plan to Linear as comment
- Updates issue status to "In Progress"
- Creates branch using Linear's `gitBranchName`
- Begins implementation following the plan

For simple issues, skip planning:

```
/implement-issue HON-51 --no-plan
```

**4. Review before PR:**

```
/code-review
```

Returns structured review with issues categorized by severity.

**5. Triage review findings:**

```
/triage-code-review
```

Categorizes issues into Address Now / Defer / Skip.

**6. Commit changes:**

```
/commit
```

After fixing critical issues, stages all changes, runs checks, and creates commit.

**7. Create PR:**

```
/pr
```

Analyzes all commits, drafts description, confirms push, and creates PR.

### Session Patterns

**Single session (small/medium issues):**

```
/next-issue → /plan-issue → [approve] → /implement-issue → /code-review → /triage → [fix] → /commit → /pr
```

**Multi-session (larger issues):**

- Session 1: `/next-issue` → `/plan-issue` → [approve]
- Session 2: `/implement-issue` → [implement]
- Session 3: `/code-review` → `/triage` → [fix] → `/commit` → `/pr`

### Cross-Session Context

- **Plan is stored in Linear:** `/plan-issue` posts the plan as a comment after approval, so `/implement-issue` and `/code-review` can fetch it in new sessions
- **Triage needs same session:** `/triage-code-review` reads `/code-review` output from conversation history. Run both in the same session.

## Subagent Patterns for Context Efficiency

When a task involves significant discovery/research before the real work begins, use a subagent to reduce context burn in the main conversation.

**When to use subagents:**

- Issue/task discovery (finding what to work on)
- Codebase exploration for unfamiliar areas
- Documentation lookups
- Dependency analysis

**Pattern:**

1. Create a skill with `context: fork` and `agent: general-purpose`
2. Restrict tools to only what's needed via `allowed-tools`
3. Define a clear output format for the summary
4. Main agent receives condensed output (~500-1000 words vs ~8-10k tokens)

**Example skills:**

- `/next-issue` - Find next unblocked Linear issue (see `.claude/skills/next-issue/`)

**Creating a new skill:**

```
.claude/skills/
└── your-skill/
    └── SKILL.md
```

See [Claude Code Skills Documentation](https://docs.anthropic.com/en/docs/claude-code/skills) for full configuration options.

## Pull Request Workflow

### Updating PR Descriptions

When pushing additional commits to an existing PR, always check if the PR description needs updating:

```bash
# Check current PR description
gh pr view --json title,body

# Review what changed in new commits
git log origin/main..HEAD --oneline
```

**Update the description if:**

- New features or fixes were added
- Implementation approach changed significantly
- Test plan needs updating
- Breaking changes were introduced
- File renames or structural changes occurred
- Scope of the PR expanded or changed

**Update using:**

```bash
gh pr edit --body "$(cat <<'EOF'
Updated description here...
EOF
)"
```

**When NOT to update:**

- Minor refactoring with same outcome
- Fixing typos or formatting
- Addressing review comments without changing scope
- Small bug fixes within the original scope

Keeping PR descriptions current helps reviewers understand the full context and ensures accurate documentation in git history (especially important for squash-merge).

## CI Pipeline

All changes must pass the following checks in GitHub Actions:

- `pnpm lint` - ESLint rules
- `pnpm type-check` - TypeScript type checking
- `pnpm test` - Unit tests

**Important notes:**

- Build verification happens through Vercel deployment (not in CI)
- E2E tests are currently disabled in CI but should be run locally before submitting PRs with `pnpm test:e2e`

## Production Deployment Process

**Manual deployment:** Run database migrations first, then deploy code via GitHub Actions.

**Flow:** Merge to main → Test in staging → Run production migration workflow → Run production deployment workflow

**Why manual:** Prevents code deploying before migrations complete (configured via Vercel Ignored Build Step).

**Detailed guide:** See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Commit Message Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:

```
<type>(<scope>): <subject>

<body>
```

**Type:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`

**Scope (optional):** Component, feature, or area of the codebase affected

**Subject:** Capitalize first word, use imperative present tense ("Add" not "add", "added", or "adds")

**Body (optional):** Detailed explanation of what and why (not how)

**Examples:**

- `feat(auth): Add OAuth login support`
- `fix(ui): Resolve alignment issue in mobile header`
- `docs: Update installation instructions`
- `chore(deps): Update Next.js to 15.5.3`
- `test(hooks): Add tests for useAuth hook`

## MCP Server Configuration

MCP (Model Context Protocol) enhances Claude Code with specialized tools and context providers.

**Configured servers**: filesystem, github, sequential-thinking, memory, playwright, npm-package-search, next-devtools (in `.mcp.json`); better-auth, context7, linear-server (HTTP, configured globally)

**Key servers:** filesystem (file ops), github (API integration), sequential-thinking (complex planning), memory (session persistence), playwright (E2E tests), better-auth (auth docs), context7 (library docs), linear-server (issue management)

**Verify status:** `claude mcp list`

**Setup, troubleshooting, and detailed configuration:** See [docs/MCP_SETUP.md](docs/MCP_SETUP.md)

### Permission Presets

Common operations are pre-approved in `.claude/settings.local.json`: gh commands, git (checkout/status/branch/log/diff), pnpm scripts (lint/test/db/build/playwright), MCP tools (better-auth/context7/linear-server), WebSearch.

**Not pre-approved:** git commit/push, destructive git ops, file modifications, production deployments.

### Development Environment Health Check

Run `./scripts/health-check.sh` to validate tools, environment variables, dependencies, and code quality. Use after cloning, when troubleshooting, or before submitting PRs.

## Cyrus/Linear Integration

**Cyrus** is an autonomous AI agent that monitors Linear issues, creates isolated Git worktrees, and processes tasks using Claude Code.

**What it does:** Detects Linear issues assigned to Cyrus → Creates worktree → Runs `.claude/cyrus-setup.sh` → Implements changes → Posts results to Linear → Creates PR

**Security:** Safe mode (read/edit files, git/gh/pnpm commands, no arbitrary bash)

**Usage:** Run `./scripts/cyrus-start.sh` then assign Linear issues to Cyrus bot

**Setup, configuration, and troubleshooting:** See [docs/CYRUS_GUIDE.md](docs/CYRUS_GUIDE.md)

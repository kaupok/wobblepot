# Honkadori - Code Guidelines

In conversational responses, prioritize brevity. Keep explanations concise and direct.

## Table of Contents

- [Project Overview](#project-overview)
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

A Next.js 15 project with React 19, using TypeScript, Tailwind CSS, and shadcn/ui components.

## Tech Stack

- **Framework**: Next.js 15.5.3 with Turbopack
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

**Schema:** `prisma/schema.prisma` - Current models: User, Session, Account, Verification (for Better Auth)

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

**Pre-commit hook:** Automatically prevents commits to `main`. New team members run `./scripts/setup-git-hooks.sh`

**Detailed guide and recovery procedures:** See [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)

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

**Configured servers** (in `.mcp.json`): filesystem, github, sequential-thinking, memory, playwright, npm-package-search, next-devtools, better-auth (HTTP), context7 (HTTP)

**Key servers:** filesystem (file ops), github (API integration), sequential-thinking (complex planning), memory (session persistence), playwright (E2E tests), better-auth (auth docs), context7 (library docs)

**Verify status:** `claude mcp list`

**Setup, troubleshooting, and detailed configuration:** See [docs/MCP_SETUP.md](docs/MCP_SETUP.md)

### Permission Presets

Common operations are pre-approved in `.claude/settings.local.json`: gh commands, git (checkout/status/branch/log/diff), pnpm scripts (lint/test/db/build/playwright), MCP tools (better-auth/context7), WebSearch.

**Not pre-approved:** git commit/push, destructive git ops, file modifications, production deployments.

### Development Environment Health Check

Run `./scripts/health-check.sh` to validate tools, environment variables, dependencies, and code quality. Use after cloning, when troubleshooting, or before submitting PRs.

## Cyrus/Linear Integration

**Cyrus** is an autonomous AI agent that monitors Linear issues, creates isolated Git worktrees, and processes tasks using Claude Code.

**What it does:** Detects Linear issues assigned to Cyrus → Creates worktree → Runs `.claude/cyrus-setup.sh` → Implements changes → Posts results to Linear → Creates PR

**Security:** Safe mode (read/edit files, git/gh/pnpm commands, no arbitrary bash)

**Usage:** Run `./scripts/cyrus-start.sh` then assign Linear issues to Cyrus bot

**Setup, configuration, and troubleshooting:** See [docs/CYRUS_GUIDE.md](docs/CYRUS_GUIDE.md)

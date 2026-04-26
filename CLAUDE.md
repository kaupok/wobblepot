# Honkadori - Code Guidelines

In conversational responses, prioritize brevity. Keep explanations concise and direct.

## Project Overview

A Next.js 16 project with React 19, using TypeScript, Tailwind CSS, and shadcn/ui components.

**Product:** AI-powered family meal planning app for households. 'Honkadori' is the parent company / legal entity (used for vendor accounts, DPAs, subprocessor listings, and the staging domain `honkadori.xyz`) — the user-facing service name is separate and not yet finalised.

**Product Spec:** The full product spec is in [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md). Read it before starting implementation work.

## Documentation Structure

| Document                                         | Contains                                             | When to Read                |
| ------------------------------------------------ | ---------------------------------------------------- | --------------------------- |
| **This file**                                    | Coding patterns, universal standards                 | Every session (auto-loaded) |
| **[docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md)** | Product vision, decisions, phase goals, domain logic | Before implementation work  |

**Rule:** CLAUDE.md tells you _how_ to code. The project spec tells you _what_ to build and _why_.

## Agent memory

**Do not use the Claude Code auto-memory system** (`~/.claude/projects/*/memory/`) — it's machine-local and creates cross-machine inconsistency. All agent guidance, project facts, behavioural rules, and cross-session context belong in this file (CLAUDE.md), `docs/`, or the relevant `.claude/skills/*/SKILL.md`. If you find yourself wanting to "save this for next session," write it to a portable in-repo file instead.

## Tech Stack

- **Framework**: Next.js 16.1.1
- **Language**: TypeScript 5.9
- **Styling**: Tailwind CSS 4.1 with class-variance-authority
- **Testing**: Vitest for unit tests, Playwright for E2E
- **Linting**: ESLint 9 + Prettier
- **Package Manager**: pnpm 10.9
- **Data Fetching**: TanStack Query (React Query) v5 for client-side
- **Database**: PostgreSQL (Neon) with Prisma ORM
- **Authentication**: Better Auth

## Architecture Overview

### Directory Structure

- **/app**: Next.js App Router (routes, layouts, error boundaries)
- **/components**: Reusable UI components
  - `/ui`: shadcn/ui primitives (button, card, typography, input, label, etc.)
  - Root level: Feature components (header, theme-toggle, etc.)
- **/lib**: Shared utilities, configuration, and service clients
  - `api.ts`: Shared fetch utility for TanStack Query (`apiFetch`)
  - `auth.ts` / `auth-client.ts`: Better Auth (server / client)
  - `env.ts`: Environment variable validation (Zod schemas)
  - `get-query-client.ts`: TanStack Query client singleton
  - `prisma.ts`: Prisma client singleton
  - `utils.ts`: Utility functions (cn, etc.)
- **/hooks**: Custom React hooks
- **/e2e**: Playwright E2E tests
- **/prisma**: Database schema and migrations

### Key Patterns

- **Server Components by default** - "use client" only for interactivity, browser APIs, or hooks
- **Colocated tests** - `.test.tsx` / `.test.ts` next to source files
- **Colocated stories** - `.stories.tsx` next to components (see Storybook section)
- **Absolute imports** - `@/` prefix for all imports
- **Type-safe env vars** - Validated with Zod at startup (see `lib/env.ts:3`)

## File Organization

### Naming Conventions

- **Components**: PascalCase (`UserProfile.tsx`)
- **Utilities/Hooks**: camelCase (`utils.ts`, `useAuth.ts`)
- **Tests**: Source name + `.test.ts(x)` suffix

### Where to Put New Code

- **shadcn UI primitives** → `/components/ui`
- **Feature components** → `/components` root level
- **Route-specific components** → Colocate in `/app/[route]/`
- **Shared hooks** → `/hooks`
- **Utilities & config** → `/lib`
- **API routes** → `/app/api/[route]/route.ts`

## Authentication Patterns

**Better Auth** for email/password authentication (no OAuth yet).

- Server: `@/lib/auth` (Server Components, API routes)
- Client: `@/lib/auth-client` (Client Components)
- API: `/api/auth/[...all]` (handles all auth endpoints)

**Protected routes:** Check session with `auth.api.getSession({ headers: await headers() })`, redirect if null. See `src/app/profile/page.tsx:8-15`

**Client-side auth:** Use `authClient.signIn.email()` with callbacks. See `src/app/sign-in/SignInForm.tsx:60-78`

**Sign out:** `authClient.signOut()` + `router.push()` + `router.refresh()`

**Templates:** `.claude/templates/auth-protected-route.tsx` and `.claude/templates/auth-form.tsx`

## Data Fetching Patterns

**Server Components (preferred):** Fetch directly in async Server Components. See `src/app/page.tsx:8-11`

**Client Components:** TanStack Query (`@tanstack/react-query`) for all client-side data fetching.

- **Reads:** `useQuery` — never `useEffect` + `fetch` + `useState`
- **Mutations:** `useMutation` — never manual `try/catch/finally` with loading state
- **Cache invalidation:** `invalidateQueries` — never `router.refresh()` for data revalidation
- **Optimistic updates:** `useMutation` with `onMutate`/`onError`/`onSettled` — never manual state snapshots

**Key files:** `src/lib/api.ts` (`apiFetch` utility), `src/lib/get-query-client.ts` (client singleton), `src/app/providers.tsx` (QueryClientProvider)

### Query Key Conventions

- Entity lists: `['meals']`, `['recipes']`, `['shopping-list', planId]`
- Single entities: `['meal', mealId]`, `['meal-plan', planId]`
- Nested resources: `['meal-plan', planId, 'entries']`
- Filtered queries: `['meals', { search: query }]`

### Read Pattern

```tsx
const { data, isLoading, error } = useQuery({
  queryKey: ['entity', id],
  queryFn: () => apiFetch(`/api/entity/${id}`),
})
```

### Mutation Pattern

```tsx
const queryClient = useQueryClient()
const mutation = useMutation({
  mutationFn: (data) => apiFetch('/api/entity', { method: 'POST', body: JSON.stringify(data) }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['entity'] }),
  onError: (error) => toast.error(error.message),
})
```

### Don'ts

- **Never** use `useEffect` to fetch data — use `useQuery`
- **Never** use `useState` for loading/error state of fetches — use query/mutation result
- **Never** use `router.refresh()` for cache invalidation — use `invalidateQueries`
- **Never** implement manual optimistic updates — use `useMutation` with `onMutate`

## Error Handling Strategy

**Route-level error boundaries** via `error.tsx`. Use Typography components for error UI. Show detailed errors only in dev mode. See `src/app/error.tsx`

**User-friendly error messages:** Map technical errors to friendly messages. See `src/lib/auth-errors.ts:5-90`

## Form Handling Patterns

**Native HTML forms** with controlled inputs (no form library). Use `useState` for form state, `onSubmit` with `e.preventDefault()`, disable inputs during submission. See `src/app/sign-in/SignInForm.tsx:22-92`

**Validation:** HTML5 attributes + custom validation in submit handler + server-side via Better Auth

## Code Standards

### TypeScript & Linting

- Strict TypeScript mode
- ESLint rules enforced by CI; Prettier formatting (`pnpm format`)
- Use exact dependency versions (no `^` or `~`)

### Styling

- Tailwind CSS for styling; shadcn/ui for reusable components
- Use `tailwind-merge` for dynamic class merging; avoid inline styles

### Components & Hooks

- Functional components only; React hooks for state; TypeScript types for props

### Text Casing Convention

Use **sentence case** for all UI text (buttons, headings, labels, links): "Sign in" not "Sign In" or "SIGN IN". Exception: single-word items ("Profile", "Settings").

## Typography Components

Variant-based components: `Heading` (h1-h4), `Body` (default/lead/large/small/muted), `Blockquote`, `Ul`/`Ol`/`Li`, `Code`, `Pre`.

**Core rule:** Typography components handle text styling only. Apply layout (margins, padding, positioning) via wrapper elements, not directly on the component. Only pass text-styling classes (colors, sizes, weights) to `className`.

**DO:** `<div className="mt-4"><Heading>Title</Heading></div>`

**DON'T:** `<Heading className="mt-4 mb-6">Title</Heading>`

**Full guide with examples:** See [docs/TYPOGRAPHY.md](docs/TYPOGRAPHY.md)

## Environment Variables

Validated at runtime using Zod (`src/lib/env.ts`).

- Client-side: `import { clientEnv } from '@/lib/env'` (only `NEXT_PUBLIC_*` vars)
- Server-side: `import { serverEnv } from '@/lib/env'` (all vars)

**Setup:** See [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md)

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

**Migration SQL:** Always use actual PostgreSQL table names (from `@@map`) in migration SQL, NOT Prisma model names. Example: `"household_preferences"` not `"HouseholdPreferences"`.

**CRITICAL: Never run destructive database commands (`migrate reset`, `db push --force-reset`, `DROP`, etc.) on staging or production.** These destroy real data. Always ask the user before taking any destructive action on shared environments — even to fix migration issues. Prefer `migrate resolve` or manual SQL fixes instead.

## Testing

**Unit/Component Tests** (Vitest + Testing Library): Colocate with source files. Use `describe`/`it`, accessibility queries (`getByRole`), focus on user-facing behavior. See `src/components/ui/button.test.tsx`

**Commands:** `pnpm test`, `pnpm test:coverage`, `pnpm test:e2e`, `pnpm test:all`

**What to test:** Component rendering, variants/states, user interactions, error handling, utility functions, custom hooks

**TanStack Query in tests:** Components using `useQuery`/`useMutation` need a `QueryClientProvider` wrapper. Use `createQueryWrapper()` from `src/test/query-wrapper.tsx` — it creates a fresh `QueryClient` per test with retries disabled.

**E2E Tests** (Playwright): Run with `pnpm test:e2e`. Config: `playwright.config.ts`. Specs live in `tests/e2e/*.spec.ts`; see [`tests/e2e/README.md`](./tests/e2e/README.md) for tiers, selector conventions, and the spec-header convention.

**CRITICAL: When modifying `src/app/**/page.tsx`, changing a route's URL, renaming a navigation/CTA copy string, or restructuring a modal/dialog, grep `tests/e2e`for references and update the affected specs in the same PR.** The tier 1 E2E check catches drift on`main`, but specs that reference removed routes or renamed copy are cheap to miss locally and expensive to fix in batch (see HON-518). Use the per-spec `// ROUTES: … · COMPONENTS: …` header comments to scope the grep. This is part of the definition of done — the same loud-rule treatment as colocated Storybook stories.

## Storybook

**Storybook 10** with `@storybook/nextjs-vite` for component development and review in isolation.

**Commands:** `pnpm storybook` (dev server on port 6006), `pnpm build-storybook` (static build), `pnpm test-storybook` (watch mode), `pnpm test-storybook:ci` (run every story once through `@storybook/addon-vitest` in Chromium — a11y gate + play functions)

**Config:** `.storybook/main.ts` and `.storybook/preview.tsx`. Preview wires up Geist fonts, `globals.css`, `QueryClientProvider`, Next.js app-router mocking (`nextjs.appDirectory: true`), and a light/dark theme toggle via a custom `withTailwindTheme` decorator that toggles the `dark` class on `document.documentElement` so Radix portal content (Dialog, Select, DropdownMenu) inherits the theme.

**CRITICAL: When creating or modifying a component in `/src/components/**`, create or update a colocated `.stories.tsx`file covering all variants and states.** Stories live next to the component (e.g.`Button.tsx`+`button.stories.tsx`). This is part of the definition of done — Storybook is maintained by the agentic workflow so it stays current.

**What a story should cover:**

- Every variant/size exposed by the component's props (e.g. all CVA variants)
- Key states: default, disabled, loading, empty, error
- With and without optional props that change rendering (e.g. description present vs. absent)
- An `AllVariants` render story showing variants side-by-side when useful for visual review

**Conventions:**

- Title uses `UI/ComponentName` for primitives, `Feature/ComponentName` for feature components (e.g. `Meal plan/MealCardBase`)
- Add `tags: ['autodocs']` to auto-generate docs pages
- Use `satisfies Meta<typeof Component>` for type-safe args
- Mock data for feature components: inline in the story file — don't reach into fixtures unless already shared

**Scope:**

- Stories cover rendering and variants (every CVA variant, empty/loading/error states).
- Add a `play` function when the component has a behavioural contract worth regression-testing in CI — modals (open/close/escape), search-and-select flows, form submission, keyboard handling, callback wiring. Assert on `fn()` spies, not just DOM presence. Radix portal content requires `within(document.body)`. Example: `src/components/meal-plan/MealDetailModal.stories.tsx`.
- **Modal play functions must assert interaction a11y** — focus trap on open, Escape closes and fires `onOpenChange(false)`, tab order stays within the dialog, and the close sequence completes (dialog unmounts). Use the shared helpers in `src/stories/a11y-helpers.ts` (`assertFocusInDialog`, `assertTabStaysInDialog`, `awaitDialogClosed`, `openViaTrigger`, `pressEscape`). Axe cannot see these — they are the whole point of having a play function on a modal. Focus-restore on close is intentionally not asserted in Storybook: it's a Radix contract tied to the real trigger at the real callsite, and E2E owns that assertion (see HON-446). See `.storybook/README.md` → "Modal a11y play-function conventions" for the pattern.
- `.test.tsx` files remain the home for logic-heavy, non-DOM unit tests (pure functions, hooks, reducers).

See [`.storybook/README.md`](./.storybook/README.md) for the play-function pattern (imports, `waitFor`, spies, MSW integration).

**a11y gate:** Every story runs through axe via `@storybook/addon-vitest` in CI. `.storybook/preview.tsx` sets `a11y: { test: 'error' }`, so any violation fails the `Run Storybook a11y tests` step and blocks the PR. When adding a story:

- **Fix real violations** in the component or story (missing labels, low contrast, bad ARIA, etc.). Most are real bugs worth fixing.
- **Waive false positives narrowly** at the story level with a `// WHY:` comment explaining why the rule doesn't apply. Keep waivers rule-scoped, not blanket skips:

  ```tsx
  // WHY: This story renders all palette swatches; contrast is not applicable.
  parameters: {
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } },
  }
  ```

- Run locally with `pnpm test-storybook:ci` before pushing if you touched a story.

## Commit Message Conventions

[Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <subject>
```

**Type:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`

**Subject:** Capitalize first word, imperative present tense ("Add" not "add" or "added")

**Examples:**

- `feat(auth): Add OAuth login support`
- `fix(ui): Resolve alignment issue in mobile header`
- `docs: Update installation instructions`
- `test(hooks): Add tests for useAuth hook`

## Git & Workflow Essentials

**CRITICAL: Never commit directly to `main`.** Always use feature branches.

**Linear integration:** Use the `gitBranchName` field from Linear issues for branch names (auto-links branch to issue). Once a PR is created, don't update Linear status manually - automation handles it.

**Linear issue reads — always pass `includeRelations: true`.** This rule applies to every `get_issue` call, not just inside skills. `list_issues` never returns relations, and the default `get_issue` response strips `blocks` / `blockedBy` / `relatedTo`. Before discussing, recommending, surfacing, or acting on an issue, re-fetch it with `includeRelations: true` and check the `status`, `assignee`, and `relations.blockedBy` fields. When delegating issue selection to a subagent, include the same requirement in the prompt — subagents default to reading titles and descriptions and miss structured fields unless told.

**Linear issue references — use plain text (`HON-455`), never hand-copied `<issue id="uuid">` tags.** Linear auto-resolves plain text on save. Hand-copying a `<issue id="uuid">` tag from one description into another risks silent mis-linking — the UUID controls where the link goes, not the HON text beside it, so a reference can look correct in plain-text review but click through to the wrong issue.

**Before committing:** Run `pnpm lint && pnpm type-check && pnpm test`

**Pre-commit hook:** Husky + lint-staged runs type-check, ESLint, and Prettier on staged files.

**Merging:** Never merge a PR without explicit user request. When the user runs `/merge`, execute without unnecessary confirmation.

**CI Pipeline:** All PRs must pass `pnpm lint`, `pnpm type-check`, `pnpm test`. Build verification via Vercel deployment.

**Detailed guide:** See [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)

## Skill Workflow

**Recommended sequence:** `/next-issue` → `/plan-issue HON-XX` → `/implement-issue HON-XX` → `/code-review` → `/commit --pr` → `/triage-pr-comments` → `/commit --push` → `/merge`

**Single session (small issues):** `/code-review` → fix → `/commit --pr` → `/triage-pr-comments` → fix → `/commit --push` → `/merge`

**Multi-session (larger issues):**

1. `/next-issue` → `/plan-issue` → approve plan
2. `/implement-issue` → write code
3. `/code-review` → fix → `/commit --pr`
4. `/triage-pr-comments` → fix → `/commit --push` (if review comments)
5. `/merge` (after PR approval)

**Fully autonomous:** `/auto-implement HON-XX` runs the entire cycle unattended.

**Staging review:** `/chrome-review` — Interactive exploration of staging (`honkadori.xyz`) using Chrome. Discuss findings and create Linear issues collaboratively. Requires `claude --chrome` or `/chrome`.

**Voice review:** `/voice-review` — Voice-powered staging review combining VoiceMode + Chrome. Talk through the app hands-free, discuss findings by speaking, and create Linear issues. Requires `claude --chrome` or `/chrome` and VoiceMode MCP server. See [docs/VOICE_REVIEW.md](docs/VOICE_REVIEW.md).

**Codebase audit:** `/tech-audit` — Scan for outdated deps, type issues, code quality, test coverage, security patterns, database health, bundle concerns, and pattern adherence. Use `--focus <area>` to audit a single area.

**Cross-session context:** Plans are stored as Linear comments by `/plan-issue`, so `/implement-issue` and `/code-review` can fetch them in new sessions.

### Writing for Agents

Specs, plans, and issues are consumed by agents — coding agents (`/auto-implement`), but also product, design, and growth agents. Write for both:

- **Include the "why":** Agents need enough context and reasoning to make good judgment calls, not just a task list. State the problem, the user need, and key constraints.
- **Be explicit about the "what":** Reference file paths, function names, data shapes, and expected behavior. No vague descriptions an agent must guess at.
- **Be actionable:** Concrete, unambiguous steps. An agent should be able to execute without asking clarifying questions.
- **Define done:** Testable acceptance criteria — not "works correctly" but specific observable outcomes.
- **Self-check:** "Could an agent complete this from the issue alone, without the conversation that produced it?"

This applies to `/ideate`, `/refine-backlog`, `/plan-issue`, and any content that feeds into the agentic workflow.

## Working style

**Verify from code + Linear before asking the user or asserting non-existence.** Before claiming "X doesn't exist" or asking the user about project setup (env, deploy, infra, existing features):

1. Read the relevant docs — the Reference table below points to `docs/DEPLOYMENT.md`, `docs/GIT_WORKFLOW.md`, `docs/ENVIRONMENT_SETUP.md`, `docs/PARALLEL_WORKFLOW.md`, etc. Those are the authoritative map.
2. Check all plausible homes for the feature. A CSP header can live in `middleware.ts`, `next.config.ts` `headers()`, an edge-config file, or a custom server — don't generalise from one file.
3. Grep broadly for the feature name or a distinctive string (`grep -r "Content-Security-Policy"`). One wide grep beats multiple targeted reads.
4. If an issue references another (even as `relatedTo`), fetch the referenced issue with `includeRelations: true` and check `status` / `completedAt` / `attachments`. A "Done" status with an attached PR means the feature has shipped — don't reason about it as an active dependency.
5. If genuinely absent after all of the above, lead with "I checked X, Y, Z, grepped for Q, and looked up HON-NNN — no match" so the user can verify the coverage.

The failure mode this prevents: checking one file, finding nothing, and generalising to "the feature doesn't exist" — then taking bad actions like promoting a shipped issue to a blocker.

**Don't use `ScheduleWakeup` as a "fallback" inside skills with defined endpoints.** Skills like `/auto-implement`, `/implement-issue`, `/merge`, `/code-review` complete naturally (success, failure, or user input). If you're waiting on a long-running thing (CI, build, deploy), use `Bash` with `run_in_background: true` and an `until`-poll — that emits a single completion notification when the loop exits. A wake-up scheduled "just in case" will fire after the work has already finished and re-trigger the skill on stale state (HON-529 cycle re-fired `/auto-implement 529` ~9 minutes after the PR had already merged). `ScheduleWakeup` is for true polling/iteration use cases (`/loop`, `/babysit-prs`), not for defined-endpoint work.

## Review Focus

- Flag actual bugs and logic errors
- Suggest improvements only if they have clear value
- Skip nitpicking on formatting (Prettier handles it)
- Ensure tests are meaningful and cover the changes
- Watch for TypeScript strictness violations

## Reference

| Document                                               | Contents                                                 |
| ------------------------------------------------------ | -------------------------------------------------------- |
| [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md)           | Product vision, decisions, domain logic                  |
| [docs/TYPOGRAPHY.md](docs/TYPOGRAPHY.md)               | Full typography component guide with examples            |
| [docs/FEATURE_FLAGS.md](docs/FEATURE_FLAGS.md)         | Feature flag pattern, kill-switches, fail-open semantics |
| [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)           | Branch workflow, recovery procedures                     |
| [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md) | Environment variable setup                               |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)               | Production deployment process                            |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md)             | Bundle optimization guide                                |
| [docs/MCP_SETUP.md](docs/MCP_SETUP.md)                 | MCP server configuration and troubleshooting             |
| [docs/CHROME_TESTING.md](docs/CHROME_TESTING.md)       | Browser testing with Chrome extension                    |
| [docs/VOICE_REVIEW.md](docs/VOICE_REVIEW.md)           | Voice review setup and usage                             |
| [docs/PARALLEL_WORKFLOW.md](docs/PARALLEL_WORKFLOW.md) | Parallel Claude Code with git worktrees                  |

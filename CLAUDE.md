# Wobblepot - Code Guidelines

In conversational responses, prioritize brevity. Keep explanations concise and direct.

This file loads into every session, so it holds only what most sessions need. A rule for one task lives in the skill or doc that task reads. `scripts/check-steering-size.test.ts` caps its size.

## Writing style

Write in ASD-STE100 (Simplified Technical English) at about 80%, in chat and in anything you write for Linear. The full rule reads fast and never needs a second pass, but it drops the reasoning between facts, which is the part a reader uses to decide.

Keep, always:

- Short sentences, mostly under 20 words, one idea each.
- Active voice, present tense.
- One name per thing, no synonyms. A button called Remove is "Remove" every time.
- No idioms, no filler, no hedging phrases.

Relax, when it carries meaning:

- Join cause and effect in one sentence with "so" or "because".
- Put a trade-off inside a question, so the user can decide in one read.
- Follow a judgment call with one sentence of reason.
- Run to about 25 words when the alternative is a repeated subject.

Issue descriptions and acceptance criteria stay close to the full rule, one fact per line, but keep the why as its own line: see Writing for Agents. Chat takes the wiggle room.

**Name the thing, not its number.** In chat, a bare `HON-1056` or `#1151` tells the user nothing. Say what the thing is in plain words every time ("the landing button wording"), and put the identifier after it in parentheses only where the user may want to open it. The same holds for a PR, a document, a dashboard, and any label you coined in the session ("option A", "the gate"). A list of work names each item by what it does. Before you send, check: can the user say what each thing is from this message alone? Linear text keeps plain `HON-123` references, because Linear turns each into a link that carries the title.

## Project Overview

**Product:** AI-powered family meal planning app for households. The user-facing brand is **Wobblepot** ("WOB-bul-pot"). _Honkadori OÜ_ is the parent legal entity (vendor accounts, DPAs, subprocessors, AKI registration) and the name the package and Linear workspace still carry. User-facing copy and email live on `wobblepot.com`, staging on `wobblepot.dev`; the legal entity appears in policy text only.

## Documentation Structure

CLAUDE.md says _how_ to code. The project spec says _what_ to build and _why_. The design guide says what it should _look like_.

- `docs/PROJECT_SPEC.md`: before implementation. Product, decisions, domain glossary
- `docs/DESIGN.md`, `docs/TYPOGRAPHY.md`: before any UI change. Also focus management
- `docs/LOCALIZATION.md`, `docs/AI_VOICE_ET.md`: before adding user-visible text
- `docs/TESTING.md`, `tests/e2e/README.md`: before writing tests. E2E drift, driven screens
- `docs/GIT_WORKFLOW.md`: branch names, migration immutability, recovery
- `docs/PARALLEL_WORKFLOW.md`: before queueing work or debugging an unattended run
- `docs/DEPLOYMENT.md`: CI pipeline, coverage and lockfile gates, deploys
- `docs/AGENT_HISTORY.md`: the incident behind each rule. Read before changing or disputing one
- `docs/SECURITY.md`, `compliance/`: CSP, MCP OAuth, Better Auth schema; DPAs, DPIA
- `docs/AI_MODELS.md`, `docs/FEATURE_FLAGS.md`, `docs/RUNBOOKS/`, and setup guides for environment, email, MCP and browser review

## Agent memory

Do not use the Claude Code auto-memory (`~/.claude/projects/*/memory/`): it is machine-local, so machines drift apart. Save guidance and cross-session context in this file, `docs/`, or the relevant `.claude/skills/*/SKILL.md`.

## Tech Stack

Exact versions are pinned in `package.json`. The majors:

- **Framework**: Next.js 16 (App Router), React 19, TypeScript 5.9
- **Styling**: Tailwind CSS 4 with class-variance-authority, shadcn/ui
- **i18n**: next-intl 4, catalogs in `messages/`
- **Data**: PostgreSQL (Neon) with Prisma 7; TanStack Query v5 on the client
- **Auth**: Better Auth (email/password; OAuth 2.1 server for MCP clients)
- **AI**: Vercel AI SDK with Claude
- **Services**: PostHog (analytics, flags, errors), Upstash Redis (rate limits), Resend (email), Vercel (hosting)
- **Testing**: Vitest, Playwright, Storybook 10
- **Tooling**: ESLint 10 + Prettier, pnpm 10

## Architecture Overview

- `src/app`: routes, layouts, error boundaries; API routes in `src/app/api/**/route.ts`; route-specific components colocated in the route's folder
- `src/components/ui`: shadcn/ui primitives plus hand-written ones (`confirm-dialog`, `number-input`, `typography`)
- `src/components/<feature>` (`meal-plan`, `timeline`, `recipes`, `household`, `inventory`, `pantry`, `shopping`); app chrome sits at the `src/components` root
- `src/lib`: utilities and service clients: `api.ts` (`apiFetch`, `ApiError`), `auth.ts` / `auth-client.ts`, `env.ts`, `get-query-client.ts`, `prisma.ts`, `utils.ts` (`cn`), and `i18n/`, `ai/`, `meal-planning/`
- `src/hooks`, `src/stories` (scenarios, a11y helpers), `src/test` (test utilities), `messages/`, `tests/e2e`, `prisma/`
- `scripts/`: CI checks, the orchestrator and `wt`, the PR reviewer, the AI eval (`pnpm ai-eval`)

**Patterns:** Server Components by default, "use client" only for interactivity, browser APIs or hooks. Tests (`.test.ts(x)`) and stories (`.stories.tsx`) sit next to their source. `@/` imports. Components in PascalCase files, utilities and hooks in camelCase.

## Authentication Patterns

**Better Auth**, email/password and Google sign-in (off without its env vars; sign-up passes the same invite and consent gates). It is also the OAuth 2.1 server for MCP clients (`mcp()` plugin, `/consent`, root `.well-known` routes; see docs/SECURITY.md). Server: `@/lib/auth`. Client: `@/lib/auth-client`. API: `/api/auth/[...all]`.

**Protected routes:** check the session with `getSession()` from `@/lib/session` and redirect if null (`requireAccountMember` in `src/app/account/account-member.ts`). `src/proxy.ts` also redirects anonymous requests for `PROTECTED_PREFIXES` to `/sign-in?returnUrl=…`, so they never stream a 200 + skeleton first. It checks the cookie only, so the page owns the real check. `src/proxy.test.ts` fails on a top-level route in neither `PROTECTED_PREFIXES` nor `PUBLIC_ROUTES`.

**Client:** `authClient.signIn.email()` with callbacks (`src/app/sign-in/SignInForm.tsx`). Sign out: `authClient.signOut()` + `router.push()` + `router.refresh()`. Templates are in `.claude/templates/`.

## Data Fetching Patterns

**Server Components (preferred):** fetch directly in async Server Components (`src/app/page.tsx`).

**Client Components:** TanStack Query for all client-side data: `useQuery`, not `useEffect` + `fetch` + `useState`; `useMutation`, not manual `try/catch/finally`; loading and error state from the result. Invalidate with `invalidateQueries`, not `router.refresh()`. Optimistic updates use `onMutate`/`onError`/`onSettled`. Fetch with `apiFetch` (`src/lib/api.ts`).

**Query keys:** `['meals']`, `['shopping-list', planId]`, `['meal', mealId]`, `['meal-plan', planId, 'entries']`, `['meals', { search: query }]`.

## Localization

The app ships in English and Estonian, and the locale is the household's. Model: docs/LOCALIZATION.md.

- **UI strings come from the catalogs** via `useTranslations` / `getTranslations`. No hardcoded user-visible English, including `aria-label`s, toasts and error alerts.
- **Admin pages are English-only.** Under `src/app/admin/`, `src/app/api/admin/` and `src/lib/admin-links.ts`, write strings inline, with no `next-intl` and no `admin` catalog key: one operator reads them. `scripts/check-admin-untranslated.test.ts` enforces it.
- **A new or changed key goes into `messages/en.json` and `messages/et.json` in the same PR.** `catalogue-parity.test.ts` fails when keys or ICU arguments differ.
- **Do not render server error text.** Route `error` strings are English, for logs. `apiFetch` puts the route's `error` into `ApiError.message`, so `toast.error(err.message)` shows English to an Estonian household. Branch on `ApiError.status`, `code` or `body`, render catalog copy, and log the server string (`src/components/recipes/ImagineReviewDialog.tsx`).
- **Numbers, dates and enums go through `src/lib/i18n`:** `formatQuantity` / `formatInteger`, `parse-number.ts` for input (Estonians type `1,5`), `format-dates.ts` with the household's locale, `useEnumLabel` for enums.
- **Join interpolated names with separators, not prepositions** ("Pick a meal: Saturday, breakfast"), so Estonian needs no declension.
- Copy rules (sentence case, "(optional)", recipe versus meal) are in docs/DESIGN.md → Copy.

## Error Handling Strategy

Route-level `error.tsx` boundaries with Typography components; detailed errors in dev only (`src/app/error.tsx`). Map technical errors to translated messages that say what to do next (`getAuthErrorKey` in `src/lib/auth-errors.ts`, `useAuthErrorMessage` in `src/lib/auth-errors-client.tsx`).

## Form Handling Patterns

Native HTML forms with controlled inputs and `useState`, no form library. `onSubmit` with `e.preventDefault()`, inputs disabled during submission (`SignInForm`). Validation: HTML5 attributes, the submit handler, then the server.

**Focus that falls to `<body>` sends the user to the top of the page**, and axe cannot see it. Two causes recur: a control `disabled` during a request loses focus, and a Radix `Dialog` opened from controlled state has no trigger to return focus to. The fixes and the test helper are in docs/DESIGN.md → Focus management.

## Code Standards

- Strict TypeScript; ESLint enforced by CI; Prettier (`pnpm format`)
- Exact dependency versions, no `^` or `~`. When `pnpm lockfile:check` fails, see docs/DEPLOYMENT.md → Lockfile gates; never add `pnpm.overrides`
- Code files stay under 5,000 tokens (bytes / 4); a file in `scripts/file-size-allowlist.txt` may grow 5% past its cap. When one gets too big, split it by responsibility, never by deleting comments (`pnpm file-size:check`)
- Tailwind with shadcn/ui; `tailwind-merge` for dynamic classes; no inline styles
- A new `--spacing-*` token in `globals.css` also goes into `CUSTOM_SPACING_VALUES` in `src/lib/utils.ts` (docs/DESIGN.md → Spacing)
- **Sentence case** for all UI text: "Sign in", not "Sign In". Single words ("Profile") are the exception

`pnpm lint` enforces six `@shadcn/lint` rules on `src/**` (not tests or stories). Each message names the token or variant to use.

- **`no-restyle`:** a page may _place_ a component (width, margin, flex/grid). What the component owns (padding, radius, colour, type, height) comes from a variant or size prop, so add one rather than a `className` override. Exceptions: the `contracts` in `eslint.config.mjs`, and `src/components/ui/**`.
- **`no-arbitrary-values`** is off only for primitives `shadcn add` installed, listed in `eslint.config.mjs`.
- **Every escape hatch carries a one-line reason** (`allow` entries, `eslint-disable` for `shadcn/*`). A tokenless value that several callsites need becomes an `@utility` in `globals.css`.

## Typography Components

`Heading` (levels plus an `as` prop for the tag), `Body` (variants plus `tone`), `Blockquote`, `Ul`/`Ol`/`Li`, `Code`, `Pre`; form errors use `FieldError`.

**Core rule:** size and weight come from `variant`, colour from `tone`. Apply layout on a wrapper: `<div className="mt-4"><Heading>Title</Heading></div>`, never `<Heading className="mt-4">`. `shadcn/no-restyle` fails `pnpm lint` on a `text-*`, `font-*` or `m*-*` class on a type primitive. A list that sheds its prose margins takes `variant="plain"`. Guide: docs/TYPOGRAPHY.md.

## Environment Variables

Validated with Zod in `src/lib/env.ts`. Client: `clientEnv` (`NEXT_PUBLIC_*` only). Server: `serverEnv`. Setup: docs/ENVIRONMENT_SETUP.md.

## Database Patterns

**Prisma** on Neon Postgres. `import { prisma } from '@/lib/prisma'`, server-only.

**Persistence lives in `src/lib`.** Routes, pages and components call a `src/lib` function, not `@/lib/prisma`, so their tests mock that function and not Prisma. `pnpm prisma-boundary:check` names the file that breaks this; `scripts/prisma-import-allowlist.txt` only shrinks.

**Adding models:** edit `prisma/schema.prisma` → `pnpm db:migrate` → commit schema and migration. Migration SQL uses the `@@map` table names (`"household_preferences"`, not `"HouseholdPreferences"`).

**Migration immutability:** a migration on `main` is frozen, because staging and production stored its checksum. Fix forward with a new migration. CI enforces it; run it locally with `git fetch origin main && bash scripts/check-migrations-immutable.sh origin/main`. The revert procedure and the allowlist are in docs/GIT_WORKFLOW.md → Migration Immutability.

**Destructive commands:** do not run `migrate reset`, `db push --force-reset`, `DROP` or similar against staging or production. They destroy real data. Ask the user before any destructive action on a shared environment, even to fix a migration problem, and prefer `migrate resolve` or a manual SQL fix. The PreToolUse hook blocks the common forms (see Git & Workflow Essentials → Hooks).

## Testing

Vitest with Testing Library, colocated, through accessibility queries. Detail: docs/TESTING.md.

- **A test must be able to fail.** Take expected values from a literal or the acceptance criteria, not from the logic under test; assert through the public interface; assert a specific value, not `toBeDefined()`.
- `.test.tsx` runs in jsdom, `.test.ts` in node. A `.test.ts` that needs a DOM starts with `// @vitest-environment jsdom`.
- A test of a query is a `*.db.test.ts` with no `vi.mock`, run by `pnpm test:db` on PGlite. A route test mocks only its `src/lib` module.
- **Definition of done:** update the E2E specs your change makes stale, and drive each changed screen on `pnpm review:local` with a `Driven:` line in the PR (docs/TESTING.md → E2E drift, Driven screens).
- **Shared-primitive geometry:** before changing a size, padding or radius default on a `src/components/ui` primitive, a `@theme` token or a shared layout wrapper, run `/plan-issue` step 7b's greps against the old value; skeletons keep their own copy.

## Storybook

A component under `src/components` gets a colocated `.stories.tsx`, created or updated in the same change, covering its variants and key states. `pnpm stories:check` fails on a missing file; exceptions are in `scripts/check-colocated-stories.ts`. Every story passes the axe a11y gate (`pnpm test-storybook:ci`). Coverage, conventions, play functions and waivers: `.storybook/README.md`.

## Commit Message Conventions

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <Subject>`, types `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`. Capitalise the subject, imperative present tense ("Add").

## Git & Workflow Essentials

**Branches:** never commit to `main`. Use the Linear issue's `gitBranchName`, which links the branch. Other schemes, including the PostHog agent's (which overrides its harness example), are in docs/GIT_WORKFLOW.md.

**Change files only in a worktree.** Several sessions share the main checkout, so an edit or branch switch there changes files under every session. Read, chat and plan there freely. Before the first file change, call `EnterWorktree` named with the issue ID in lower case (`hon-123`), or `<prefix>/<short-slug>` of 64 characters at most. `.claude/hooks/guard-main-checkout.mts` blocks `Edit`/`Write` and branch-changing `git` there; it does not parse Bash writes (`sed -i`, redirects), so do not make those either. That worktree has no Neon branch; work that needs its own database starts with `wt new`. See docs/PARALLEL_WORKFLOW.md → Sessions in the main checkout.

**Linear:** issues live in the `Wobblebot` team (`HON`). Pass `includeRelations: true` on every `get_issue` call: the default response strips `blocks` / `blockedBy` / `relatedTo`, and `list_issues` has none. Check `status`, `assignee` and `blockedBy` before acting on an issue, and tell a subagent to do the same. Write references as plain `HON-455`, never a copied `<issue id="uuid">` tag, whose UUID can point elsewhere. Automation moves the status once a PR exists.

**Title prefixes:** `[DRAFT]` (a human-driven session, spec not ready) and `[AUTO DRAFT]` (only `/auto-implement` 6.8) both keep an issue out of unattended pickup. With a human in the loop, never use `[AUTO DRAFT]`. Rules: `/refine-backlog` → Title prefixes.

**Issue titles,** for every issue you file, in a skill or not, because a list view only scans when every title has one shape:

- Sentence case, about 80 characters at most. Detail goes in the description.
- Work starts with the implementer's verb: "Add …", "Move …", or "Let a household …" for a new thing the user can do. The verb is never the user's in-app action. Not "Implement" or "Support", which say nothing.
- A bug states the symptom the user sees, in the present tense. The cause and the fix go in the description.
- An optional screen prefix uses the name the UI shows: "Cook view: …".
- No commit type or tool prefix (`docs:`, `auto-implement:`).
- A series ends in "(1/3)".

**Queued is the queue.** The orchestrator and `/auto-implement` pick up only `Queued`; Todo means a human will do it. Queue an issue only when an agent can finish it alone, and set any `blockedBy` in the same call. Skips, overlapping files and timing: docs/PARALLEL_WORKFLOW.md → Queued is the queue.

**A follow-up is an issue.** A step the work needs but the PR does not ship is a Linear issue before the parent closes, because nobody reads a Done issue again. Rules: `/plan-issue` → A follow-up is an issue.

**Before committing:** `pnpm lint && pnpm type-check && pnpm test`. Husky runs type-check, ESLint and Prettier on staged files. **Merging:** never without an explicit user request; `/merge` runs without further confirmation.

**Hooks:** `.claude/hooks/block-destructive.sh` (PreToolUse, Bash) blocks destructive database commands, any `git push` to `main`, force pushes, and `gh pr merge` without the inline `WOBBLEPOT_ALLOW_MERGE=1` that `/merge` and `/auto-implement` add. It fires for headless workers too and matches what would execute, so a `grep` that mentions a command passes. When it blocks you, ask the user; do not route around it.

**CI:** every PR passes `pnpm lint`, `pnpm type-check`, `pnpm test` and the checks in docs/DEPLOYMENT.md → CI Pipeline.

## Skill Workflow

**Sequence:** `/next-issue` → `/plan-issue HON-XX` → `/implement-issue HON-XX` → `/branch-review` → `/commit --pr` → `/triage-pr-comments` → `/commit --push` → `/merge`. A small issue can start at `/branch-review`. Plans are Linear comments, so a new session can fetch them. `/create-pr` triggers the PR review (`/review-pr` → When to run it). `/auto-implement HON-XX` runs the whole cycle unattended. `/branch-review` is our skill; `/code-review` is the built-in diff reviewer.

**Go-to-market content stays out of this repository.** It is public, so a market, price, cohort result or channel plan written here is published. It lives in Linear (`GTM …` documents, `GTM` issues); `/gtm` has the map.

**Vendor skills** (`better-auth-best-practices`, `create-auth-skill`, `next-upgrade`) are upstream references. Where they conflict, this file wins: Prisma not Drizzle, email/password and Google only, pnpm with exact pins, TanStack Query for client reads, the Next 16 guide. Their Better Auth CLI does not work here: docs/SECURITY.md → Better Auth schema changes.

### Writing for Agents

Specs, plans and issues are read by agents with none of this conversation. Include the why: the problem, the user need, the constraints. Name file paths, functions, data shapes and expected behaviour. Give concrete steps and testable acceptance criteria. Self-check: could an agent complete this from the issue alone?

Do not nest a markdown table inside a list item in a Linear description: Linear strips the list indent off every body cell, so data is lost silently (HON-617). Keep tables at top level.

## Working style

**Verify from code and Linear before asking the user or asserting that something does not exist.**

1. Read the relevant docs; Documentation Structure is the map.
2. Check every plausible home. A CSP header can live in `src/proxy.ts`, `next.config.ts` `headers()`, or a custom server; one file proves nothing.
3. Grep broadly for the feature name or a distinctive string. One wide grep beats several targeted reads.
4. Fetch a referenced issue with `includeRelations: true`. "Done" with an attached PR means it shipped; it is not an active dependency.
5. If it is still absent, lead with what you checked ("I checked X, Y, grepped for Q — no match") so the user can verify the coverage. One file checked and the feature declared missing is how a shipped issue becomes a blocker.

**Never hand the user a check you could run: run it and quote the output.**

**Waiting inside a skill with a defined endpoint.** `/auto-implement`, `/implement-issue`, `/merge` and `/branch-review` end on their own, so do not schedule a `ScheduleWakeup` fallback: it fires after the work ends and re-runs the skill on stale state. To wait on CI, a build or a deploy, poll with foreground wait-chunks: a `Bash` call under the 600 s cap that prints a terminal or "still waiting" marker, re-issued until terminal. Do not rely on a completion notification from a backgrounded Bash call, a subagent (pass `run_in_background: false`) or Monitor: a headless worker exits when its turn ends, and the backgrounded work dies with it. Backgrounding a command that outruns the cap is fine if the same turn waits on its marker. Interactive `/merge` has a TTY, so its CI poll may run in the background. `ScheduleWakeup` is for real polling: `/loop`, or an external state change.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

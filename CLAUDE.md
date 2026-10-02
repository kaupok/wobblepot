# Wobblepot - Code Guidelines

In conversational responses, prioritize brevity. Keep explanations concise and direct.

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

## Project Overview

**Product:** AI-powered family meal planning app for households. The user-facing brand is **Wobblepot** (pronounced "WOB-bul-pot"). _Honkadori OÜ_ is the parent legal entity — used for vendor accounts, DPAs, subprocessor listings, AKI registration — and the name the package and the Linear workspace still carry. All user-facing copy and email lives on `wobblepot.com`; staging is on `wobblepot.dev`; legal-entity attribution appears in policy text only.

## Documentation Structure

| Document                                                   | Contains                                                          | When to Read                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| **This file**                                              | Coding patterns, workflow rules, each with its reason             | Every session (auto-loaded)                         |
| **[docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md)**           | Product vision, decisions, phase goals, domain logic              | Before implementation work                          |
| **[docs/DESIGN.md](docs/DESIGN.md)**                       | Visual system: type scale, tokens, composition rules, reject list | Before creating or changing any UI                  |
| **[docs/LOCALIZATION.md](docs/LOCALIZATION.md)**           | i18n model, locale plumbing, formatting helpers                   | Before adding or changing user-visible text         |
| **[docs/PARALLEL_WORKFLOW.md](docs/PARALLEL_WORKFLOW.md)** | Worktrees, the orchestrator, its outcomes and labels              | Before queueing work or debugging an unattended run |
| **[docs/AGENT_HISTORY.md](docs/AGENT_HISTORY.md)**         | The incident behind each rule here, by Linear issue               | Before changing or disputing a rule                 |

**Rule:** CLAUDE.md tells you _how_ to code. The project spec tells you _what_ to build and _why_. The design guide tells you what it should _look like_.

## Agent memory

Do not use the Claude Code auto-memory system (`~/.claude/projects/*/memory/`): it is machine-local and creates cross-machine inconsistency. Agent guidance, project facts, behavioural rules and cross-session context belong in this file, `docs/`, or the relevant `.claude/skills/*/SKILL.md`. If you want to "save this for next session", write it to one of those.

## Tech Stack

Exact versions are pinned in `package.json`. The majors:

- **Framework**: Next.js 16 (App Router), React 19, TypeScript 5.9
- **Styling**: Tailwind CSS 4 with class-variance-authority, shadcn/ui
- **i18n**: next-intl 4, catalogs in `messages/`
- **Data**: PostgreSQL (Neon) with Prisma 7; TanStack Query v5 on the client
- **Auth**: Better Auth (email/password)
- **AI**: Vercel AI SDK with Claude — see [docs/AI_MODELS.md](docs/AI_MODELS.md)
- **Services**: PostHog (analytics, feature flags, error capture), Upstash Redis (rate limits), Resend (email), Vercel (hosting)
- **Testing**: Vitest, Playwright, Storybook 10
- **Tooling**: ESLint 10 + Prettier, pnpm 10

## Architecture Overview

### Directory Structure

- `src/app`: App Router routes, layouts, error boundaries; API routes in `src/app/api/**/route.ts`
- `src/components/ui`: shadcn/ui primitives, plus the hand-written ones (`confirm-dialog`, `number-input`, `typography`)
- `src/components/<feature>` (`meal-plan`, `timeline`, `recipes`, `household`, `inventory`, `pantry`, `shopping`): feature components. App chrome (header, footer, navigation) sits at the `src/components` root
- `src/lib`: utilities, configuration, service clients — `api.ts` (`apiFetch`, `ApiError`), `auth.ts` / `auth-client.ts`, `env.ts`, `get-query-client.ts`, `prisma.ts`, `utils.ts` (`cn`), and the `i18n/`, `ai/` and `meal-planning/` modules
- `src/hooks`: shared hooks. `src/stories`: scenario stories and a11y helpers. `src/test`: test utilities
- `messages/`: next-intl catalogs (`en.json`, `et.json`)
- `tests/e2e`: Playwright specs
- `prisma/`: schema, migrations, seeds
- `scripts/`: CI checks, the orchestrator and `wt`, the PR reviewer, the AI eval (`pnpm ai-eval`, in `scripts/model-bench/`)
- `compliance/`, `docs/RUNBOOKS/`: DPAs and the DPIA; operational runbooks

### Key Patterns

- **Server Components by default** - "use client" only for interactivity, browser APIs, or hooks
- **Colocated tests** - `.test.tsx` / `.test.ts` next to source files
- **Colocated stories** - `.stories.tsx` next to components (see Storybook section)
- **Route-specific components** - colocated in the route's folder under `src/app`
- **Absolute imports** - `@/` prefix for all imports
- **Type-safe env vars** - validated with Zod: public vars when `src/lib/env.ts` loads, server-only vars on first access
- **Naming** - components in PascalCase (`UserProfile.tsx`), utilities and hooks in camelCase (`useAuth.ts`)

## Authentication Patterns

**Better Auth** for email/password authentication (no OAuth yet).

- Server: `@/lib/auth` (Server Components, API routes)
- Client: `@/lib/auth-client` (Client Components)
- API: `/api/auth/[...all]` (handles all auth endpoints)

**Protected routes:** Check session with `auth.api.getSession({ headers: await headers() })`, redirect if null. See `src/app/profile/page.tsx:8-15`. `src/proxy.ts` additionally performs an _optimistic_ session-cookie redirect (307 → `/sign-in?returnUrl=…`) for the prefixes in `PROTECTED_PREFIXES`, so anonymous requests never stream a 200 + skeleton first. It checks cookie presence only, so the page still owns the real session check. `src/proxy.test.ts` fails CI on any top-level route that isn't classified in `PROTECTED_PREFIXES` or `PUBLIC_ROUTES`.

**Client-side auth:** Use `authClient.signIn.email()` with callbacks. See `src/app/sign-in/SignInForm.tsx:60-78`

**Sign out:** `authClient.signOut()` + `router.push()` + `router.refresh()`

**Templates:** `.claude/templates/` has `auth-protected-route.tsx`, `auth-form.tsx`, `component.tsx` and `client-component.tsx`

## Data Fetching Patterns

**Server Components (preferred):** Fetch directly in async Server Components. See `src/app/page.tsx:8-11`

**Client Components:** TanStack Query (`@tanstack/react-query`) for all client-side data fetching.

- **Reads:** `useQuery`, not `useEffect` + `fetch` + `useState`
- **Mutations:** `useMutation`, not manual `try/catch/finally` with loading state
- **Loading and error state:** the query or mutation result, not `useState`
- **Cache invalidation:** `invalidateQueries`, not `router.refresh()`
- **Optimistic updates:** `useMutation` with `onMutate`/`onError`/`onSettled`, not manual state snapshots

**Key files:** `src/lib/api.ts` (`apiFetch` utility), `src/lib/get-query-client.ts` (client singleton), `src/app/providers.tsx` (QueryClientProvider)

**Query keys:** entity lists `['meals']`, `['shopping-list', planId]`; single entities `['meal', mealId]`; nested resources `['meal-plan', planId, 'entries']`; filtered queries `['meals', { search: query }]`.

```tsx
const { data, isLoading, error } = useQuery({
  queryKey: ['entity', id],
  queryFn: () => apiFetch(`/api/entity/${id}`),
})

const queryClient = useQueryClient()
const mutation = useMutation({
  mutationFn: (data) => apiFetch('/api/entity', { method: 'POST', body: JSON.stringify(data) }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['entity'] }),
  // Catalog copy, not `error.message` — see Localization.
  onError: () => toast.error(t('errors.saveFailed')),
})
```

## Localization

The app ships in English and Estonian, and the locale is the household's. [docs/LOCALIZATION.md](docs/LOCALIZATION.md) has the model; these are the rules for everyday changes.

- **UI strings come from the catalogs.** Read them with `useTranslations` (client) or `getTranslations` (server). No hardcoded user-visible English in components, including `aria-label`s, toasts and error alerts.
- **A new or changed key goes into `messages/en.json` and `messages/et.json` in the same PR.** `src/lib/i18n/catalogue-parity.test.ts` fails when the two catalogs differ in keys or ICU arguments.
- **Do not render server error text.** Route `error` strings are English and exist for logs. `apiFetch` puts the route's `error` into `ApiError.message` ahead of the translated fallback you pass it, so `setError(err.message)` or `toast.error(err.message)` shows English to an Estonian household. Branch on `ApiError.status`, `code` or `body`, render catalog copy, and log the server string. Pattern: `src/components/recipes/ImagineReviewDialog.tsx`.
- **Numbers, dates and enums go through `src/lib/i18n`:** `formatQuantity` / `formatInteger`, `parse-number.ts` for input (Estonian users type `1,5`), `format-dates.ts` with the household's locale rather than `en-US`, and `useEnumLabel` for meal types, categories and other enums.
- **Join interpolated names with separators, not prepositions** ("Pick a meal: Saturday, breakfast"), so Estonian needs no declension of the day or meal name.
- Copy rules (sentence case, "(optional)" labels, recipe versus meal) are in [docs/DESIGN.md](docs/DESIGN.md) → Copy. Estonian text the AI produces follows [docs/AI_VOICE_ET.md](docs/AI_VOICE_ET.md).

## Error Handling Strategy

**Route-level error boundaries** via `error.tsx`. Use Typography components for error UI. Show detailed errors only in dev mode. See `src/app/error.tsx`

**User-friendly error messages:** Map technical errors to friendly, translated messages. See `src/lib/auth-errors.ts:5-90`. Errors say what happened and what to do next, not what went wrong technically.

## Form Handling Patterns

**Native HTML forms** with controlled inputs (no form library). Use `useState` for form state, `onSubmit` with `e.preventDefault()`, disable inputs during submission. See `src/app/sign-in/SignInForm.tsx:22-92`

**Validation:** HTML5 attributes + custom validation in submit handler + server-side via Better Auth

### Focus management

Keyboard focus that falls to `<body>` sends the user back to the top of the page. Two causes keep recurring, and axe cannot see either:

- **A control that is `disabled` while a request is pending loses focus** (Chromium blurs it). After a failed submit, return focus to the submit button: the error path sets a ref flag, and an effect focuses the button once loading ends. `useRefocusAfterPending` (`src/hooks/use-refocus-after-pending.ts`) packages this; the auth forms use it (`src/app/sign-in/SignInForm.tsx`). Where the button must stay focusable during the request, use `aria-disabled` plus a guard in the handler (`src/components/timeline/TimelineEmptySlot.tsx`). jsdom does not blur disabled controls, so a test has to move focus to the body itself before asserting (`dropFocusToBody` in `src/test/focus.ts`).
- **A Radix `Dialog` opened from controlled state has no `DialogTrigger` to return focus to.** Pass `onCloseAutoFocus`, call `preventDefault()`, and focus the control that opened it (`MealSelectorModal` takes the prop).

## Code Standards

### TypeScript & Linting

- Strict TypeScript mode
- ESLint rules enforced by CI; Prettier formatting (`pnpm format`)
- Use exact dependency versions (no `^` or `~`)

**Lockfile gates:** CI runs `pnpm audit --audit-level critical` and `pnpm lockfile:check` on every PR. The second asserts specific resolutions in `pnpm-lock.yaml` that were cleared by hand, because `pnpm update` or a regenerated lockfile can silently undo them. When it fails, re-dedupe or upgrade the dependency that pulls the bad version, or edit the pin in `scripts/check-lockfile-pins.ts` and say why in its `why`. Do not add a `pnpm.overrides` entry: an override hides the underlying spec instead of detecting drift.

### Styling

- Tailwind CSS for styling; shadcn/ui for reusable components
- Use `tailwind-merge` for dynamic class merging; avoid inline styles
- A new `--spacing-*` token in `globals.css` must also be added to `CUSTOM_SPACING_VALUES` in `src/lib/utils.ts` — see `docs/DESIGN.md` → Spacing

`pnpm lint` enforces six `@shadcn/lint` rules as errors on `src/**/*.{ts,tsx}`: `no-raw-colors`, `no-inline-styles`, `no-arbitrary-values`, `no-unknown-classes`, `require-static-classes`, `no-restyle`. Tests and `.stories.tsx` are excluded. Each message names the offending class and the token, scale value or variant to use instead, so read the error before reaching for an escape hatch. What the messages do not say:

- **`no-restyle`:** a page may _place_ a component (width, margin, flex/grid participation). What the component owns — padding, radius, colour, type, a control's height — comes from a variant or size prop, so add one rather than a `className` override. The exceptions are the per-component `contracts` in `eslint.config.mjs`, each with its reason. The rule is off inside `src/components/ui/**`, where primitives compose each other.
- **`no-arbitrary-values`** is switched off only for primitives `shadcn add` installed, listed file by file in `eslint.config.mjs`. Hand-written primitives stay covered; add a file to that list only when the registry installed it.
- **Escape hatches carry a reason.** Every `allow` entry in `eslint.config.mjs` and every `eslint-disable` for a `shadcn/*` rule has a one-line reason. A value that has no token and that more than one callsite needs goes in `globals.css` as an `@utility` rather than an `allow`.

### Text Casing Convention

Use **sentence case** for all UI text (buttons, headings, labels, links): "Sign in" not "Sign In" or "SIGN IN". Exception: single-word items ("Profile", "Settings").

## Typography Components

Variant-based components: `Heading` (h1-h4/section/caption, plus an `as` prop that sets the HTML tag independently of the visual level), `Body` (default/lead/large/small/paragraph/muted/caption, plus a `tone` prop for colour), `Blockquote`, `Ul`/`Ol`/`Li` (`Li` takes `tone`), `Code`, `Pre`. Form errors render through `FieldError`.

**Core rule:** Typography components own their text styling: size and weight come from `variant`, colour from `tone`. Apply layout (margins, padding, positioning) via wrapper elements, not on the component. `shadcn/no-restyle` enforces both halves: a `text-*`, `font-*` or `m*-*` class on a type primitive fails `pnpm lint`, and the few text-state classes still allowed (`italic`, `line-through`, …) are listed by name in `eslint.config.mjs`. A list that must shed its prose margins takes `Ul`/`Ol` `variant="plain"`.

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

**Schema:** `prisma/schema.prisma` holds the Better Auth models and the meal-planning models. The domain glossary is in `docs/PROJECT_SPEC.md`.

**Commands:**

- `pnpm db:migrate` - Create and apply migration
- `pnpm db:studio` - Open Prisma Studio GUI
- `pnpm db:push` - Push schema without migration (dev only)
- `pnpm db:generate` - Regenerate Prisma Client
- `pnpm db:migrate:deploy` - Apply migrations (production)

**Adding models:** Edit schema → `pnpm db:migrate` → Commit schema + migration files

**Migration SQL:** Use the actual PostgreSQL table names (from `@@map`) in migration SQL, not Prisma model names: `"household_preferences"`, not `"HouseholdPreferences"`.

**Migration immutability:** a migration file is frozen once it is on `main`. By then staging and production have applied it, and Prisma stored a checksum of its `migration.sql`, so an edit only guarantees that `prisma migrate dev` demands a full database reset. Do not edit, delete or renumber an applied migration; add a new one that fixes forward. CI enforces this on every PR and again on every push to `main`.

- **If an edit lands on `main` anyway, revert the commit** rather than fixing forward. Staging and production still hold the checksum of the original SQL, so only restoring it clears the drift. The revert's PR check fails once (expected; merge it deliberately) and its `main` push goes green.
- **The only way to keep a post-merge edit** is a pin in `scripts/migration-immutability-allowlist.txt`: `<path> <blob-sha|deleted> <why>`.
- **Run it locally** with `git fetch origin main && bash scripts/check-migrations-immutable.sh origin/main`. Fetch first: a stale `origin/main` omits migrations that landed since, and editing one of those then reads as an addition and passes.

**Destructive commands:** do not run `migrate reset`, `db push --force-reset`, `DROP` or similar against staging or production. They destroy real data. Ask the user before any destructive action on a shared environment, even to fix a migration problem, and prefer `migrate resolve` or a manual SQL fix. The PreToolUse hook blocks the common forms (see Git & Workflow Essentials → Hooks).

## Testing

**Unit/Component Tests** (Vitest + Testing Library): Colocate with source files. Use `describe`/`it`, accessibility queries (`getByRole`), focus on user-facing behavior. See `src/components/ui/button.test.tsx`

**Commands:** `pnpm test`, `pnpm test:coverage`, `pnpm test:e2e`, `pnpm test:all`. `pnpm test:e2e:local` runs the E2E suite against a fresh, isolated Neon branch; `pnpm review:local` serves the app the same way for walking a flow by hand.

**TanStack Query in tests:** Components using `useQuery`/`useMutation` need a `QueryClientProvider` wrapper. Use `createQueryWrapper()` from `src/test/query-wrapper.tsx`, which creates a fresh `QueryClient` per test with retries disabled.

**E2E Tests** (Playwright): Config: `playwright.config.ts`. Specs live in `tests/e2e/*.spec.ts`; see [`tests/e2e/README.md`](./tests/e2e/README.md) for tiers, selector conventions, and the spec-header convention.

**E2E drift:** when you modify a `page.tsx` under `src/app`, change a route's URL, rename navigation or CTA copy, or restructure a modal or dialog, grep `tests/e2e` for references and update the affected specs in the same PR. Use the per-spec `// ROUTES: … · COMPONENTS: …` header comments to scope the grep. This is part of the definition of done: the tier 1 E2E check catches drift on `main`, but stale specs are cheap to miss locally and expensive to fix in batch. No CI check can enforce it, so `scripts/pr-review.sh` adds a reviewer checklist item when the diff touches a `.tsx` under `src/app` or `src/components`, a `messages/*.json` catalog, or `src/proxy.ts`. The reviewer is a backstop; the rule is yours to follow while writing the change.

## Shared-primitive geometry

Before changing a size, height, padding or radius default on a primitive under `src/components/ui/*.tsx`, a `@theme` token in `globals.css`, or a shared layout wrapper, find the callsites that hardcode a copy of the old value. Skeletons, sibling primitives sharing the old value, and `className` overrides all keep their own copy, and none of them is visible from the primitive's own file.

`/plan-issue` step 7b has the greps and the Mirror / Override / Deliberate classification; run them against the **old** literal. This is part of the definition of done. No CI check can enforce it, so `scripts/pr-review.sh` adds a reviewer checklist item that runs the step 7b greps when the diff touches `src/components/ui/*.tsx` or `src/app/globals.css`. Shared layout wrappers have no single path to gate on and are not covered.

## Storybook

**Storybook 10** with `@storybook/nextjs-vite` for component development and review in isolation.

**Commands:** `pnpm storybook` (dev server on port 6006), `pnpm build-storybook` (static build), `pnpm test-storybook` (watch mode), `pnpm test-storybook:ci` (run every story once through `@storybook/addon-vitest` in Chromium — a11y gate + play functions)

**Published build:** <https://kaupok.github.io/wobblepot/>, deployed to GitHub Pages from `main` by `.github/workflows/deploy-storybook.yml`. It is served from a sub-path, so the MSW worker URL in `.storybook/preview.tsx` is built from `import.meta.env.BASE_URL`, inside the `setupMswWorker` setup function passed to `mswLoader()`. Keep it that way: dropping the setup function silently reverts the worker to an origin-absolute URL (see `.storybook/README.md` → "Published build").

**Colocated stories:** when you create or modify a component under `src/components`, create or update its colocated `.stories.tsx` (`Button.tsx` + `button.stories.tsx`). This is part of the definition of done: Storybook is maintained by the agentic workflow so it stays current. `pnpm stories:check` fails CI when the story file is missing; keeping it current is the part the check cannot see. Deliberate exceptions live in the allowlist in `scripts/check-colocated-stories.ts`, each with a reason.

**What a story covers:** every variant and size the props expose; the key states (default, disabled, loading, empty, error); optional props that change rendering, with and without; and an `AllVariants` render story when side-by-side review is useful.

**Conventions:**

- Title uses `UI/ComponentName` for primitives, `Feature/ComponentName` for feature components (e.g. `Meal plan/MealCardBase`), and `Scenarios/<Screen>` for the composite whole-screen stories in `src/stories/scenarios/` (e.g. `Scenarios/Shopping list`)
- Add `tags: ['autodocs']` to auto-generate docs pages
- Use `satisfies Meta<typeof Component>` for type-safe args
- Mock data for feature components: inline in the story file — don't reach into fixtures unless already shared

**Play functions:**

- Add a `play` function when the component has a behavioural contract worth regression-testing in CI — modals (open/close/escape), search-and-select flows, form submission, keyboard handling, callback wiring. Assert on `fn()` spies, not just DOM presence. Radix portal content requires `within(document.body)`. Example: `src/components/meal-plan/MealDetailModal.stories.tsx`.
- **Modal play functions assert interaction a11y:** focus trap on open, Escape closes and fires `onOpenChange(false)`, tab order stays within the dialog, and the close sequence completes (dialog unmounts). Use the shared helpers in `src/stories/a11y-helpers.ts` (`assertFocusInDialog`, `assertTabStaysInDialog`, `awaitDialogClosed`, `openViaTrigger`, `pressEscape`). Axe cannot see these, which is the point of having a play function on a modal. Focus restore on close is not asserted in Storybook: it depends on the real trigger at the real callsite, so E2E owns that assertion. See `.storybook/README.md` → "Modal a11y play-function conventions".
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

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <subject>`, for example `fix(ui): Resolve alignment issue in mobile header`.

**Type:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`

**Subject:** Capitalize first word, imperative present tense ("Add" not "add" or "added")

## Git & Workflow Essentials

**Branches:** work on a feature branch; do not commit directly to `main`.

**Linear integration:** Issues live in the `Wobblebot` team (prefix `HON`). Use the `gitBranchName` field from the Linear issue as the branch name, which auto-links the branch to the issue. Once a PR is created, don't update Linear status manually; automation handles it.

**Agent-created branches carry the Linear issue ID.** When the PostHog Desktop / self-driving agent creates a branch for work that has a Linear issue, name it `posthog/<linear-branch-name>`: the issue's `gitBranchName` with the leading username segment replaced by `posthog` (`kaupokorv/hon-123-add-pantry-sync` → `posthog/hon-123-add-pantry-sync`). The ID is what makes Linear link the branch, move the issue to In Review on PR open, and attach the PR; a slug-only branch silently breaks all three. This overrides the `posthog/fix-login-redirect` naming example in the harness prompt. An issue is the source when the task names a HON-NNN, the originating report or thread references one, or the work was picked via `/next-issue`. With no issue, keep `posthog/<descriptive-slug>`; don't create one just to name a branch.

**Linear issue reads: pass `includeRelations: true` on every `get_issue` call,** inside skills or not. `list_issues` does not return relations, and the default `get_issue` response strips `blocks` / `blockedBy` / `relatedTo`. Before discussing, recommending or acting on an issue, re-fetch it with relations and check `status`, `assignee` and `relations.blockedBy`. When delegating issue selection to a subagent, put the same requirement in the prompt: subagents read titles and descriptions and miss structured fields unless told.

**Linear issue references: write plain text (`HON-455`),** not hand-copied `<issue id="uuid">` tags. Linear auto-resolves plain text on save. In a copied tag the UUID controls where the link goes, not the HON text beside it, so a reference can look correct and click through to the wrong issue.

**Linear title prefixes:** `[DRAFT]` and `[AUTO DRAFT]` mean different things. Pick by _who filed it and how_, not by copying a neighbouring title. Both keep an issue out of unattended selection (`/auto-implement` 1.5, `/next-issue --auto` step 5), but they are cleared by different passes:

- **`[DRAFT]`** — filed by a human, or by an agent in a session a human is driving (conversation, research, `/ideate`, `/refine-backlog`, `/chrome-review`), whose spec is not yet ready to implement. It means "unrefined", not "unreviewed". Cleared by `/refine-backlog` (no args) once the spec is written up.
- **`[AUTO DRAFT]`** — filed **only** by `/auto-implement` 6.8, for a review finding the unattended cycle deferred. No human saw it at birth; the prefix is the gate that stops the cycle implementing work it generated for itself. Cleared only by `/refine-backlog --auto-drafts` after a human judges the finding real and current.
- **No prefix** — ready for pickup. An issue a human reviewed as it was created (e.g. a `/branch-review` proposal the user approved) needs no prefix.

If you are filing an issue and a human is in the loop, `[AUTO DRAFT]` is wrong, even when the issue is agent-written, well-specced, or related to existing `[AUTO DRAFT]` issues. Full rules live in `.claude/skills/refine-backlog/SKILL.md` and `.claude/skills/auto-implement/deferral.md` (`/auto-implement` 6.8).

**Queued is the queue.** The orchestrator (`scripts/orchestrator.sh`, started with `wt start`) and `/auto-implement` auto-discovery read only the Linear state `Queued`; Todo and Backlog are not picked up unattended, and Todo means a human intends to do the work. Move an issue to Queued only when an agent can finish it without a human; an issue with a human-only step goes to Todo, and any unattended part is split into its own Queued issue. `/next-issue` still lists Todo, Queued and Backlog: it proposes, and moving an issue to Queued stays a human act.

- **What the orchestrator skips.** It runs up to three workers at once by default, each in its own git worktree with its own Neon branch. It skips a Queued issue that has an open `blockedBy`, and one labelled `Gated` (a worker exited without commits) or `Stranded` (a worker ended with an open, unmerged PR). Neither label clears itself: fix the cause or finish the PR, then remove the label. See [docs/PARALLEL_WORKFLOW.md](docs/PARALLEL_WORKFLOW.md) → Orchestrator.
- **Queueing issues that touch the same files.** Workers branch from the same `origin/main` and run in parallel, so two Queued issues that edit the same file produce conflicting PRs. Before queueing a batch, compare the files each issue names. Where two overlap, add a `blockedBy` between them and say in the blocked issue that the relation is for sequencing only.
- **Set `blockedBy` in the call that queues the issue.** The orchestrator sees a Queued issue within a minute, so a `blockedBy` added after the move to Queued can arrive too late: the issue is picked up, fails the blocker check and comes back `Gated`. Create or move the issue with its relation in one `save_issue` call (HON-902).

**Before committing:** Run `pnpm lint && pnpm type-check && pnpm test`

**Pre-commit hook:** Husky + lint-staged runs type-check, ESLint, and Prettier on staged files.

**Merging:** Do not merge a PR without an explicit user request. When the user runs `/merge`, execute without unnecessary confirmation.

**Hooks:** `.claude/hooks/block-destructive.sh`, a `PreToolUse` Bash hook registered in `.claude/settings.json`, blocks destructive database commands, any `git push` to `main`, force pushes, and `gh pr merge` without the inline `WOBBLEPOT_ALLOW_MERGE=1` prefix that `/merge` and `/auto-implement` add. It fires for headless workers too, and it matches what would _execute_, so a `grep` or a commit message that mentions one of these commands passes. When it blocks you, don't route around it: ask the user. A local-only reset they want can be run by hand. Tests: `scripts/block-destructive-hook.test.ts`.

**CI Pipeline:** All PRs must pass `pnpm lint`, `pnpm type-check`, `pnpm test`, and the checks named in the sections above; the full list is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) → CI Pipeline. CI builds the app for the E2E tier, and Vercel builds each deployment separately.

**Detailed guide:** See [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)

## Skill Workflow

**Recommended sequence:** `/next-issue` → `/plan-issue HON-XX` → `/implement-issue HON-XX` → `/branch-review` → `/commit --pr` → `/triage-pr-comments` → `/commit --push` → `/merge`. A small issue can start at `/branch-review`. Plans are stored as Linear comments by `/plan-issue`, so `/implement-issue` and `/branch-review` can fetch them in a new session.

**`/branch-review` vs `/code-review`:** `/branch-review` is _our_ project skill: a full current-branch review (committed + staged + unstaged + untracked) with Linear/PR context and triage. `/code-review` is the Claude Code **built-in** diff reviewer. Use `/branch-review` in the sequence above; reach for `/code-review --fix` or `ultra` when you want autofix or a deep cloud pass.

**Fully autonomous:** `/auto-implement HON-XX` runs the entire cycle unattended. With no argument it picks from the `Queued` state only, as the orchestrator does — see "Queued is the queue" above.

**PR review is automatic; don't invoke `/review-pr` by hand in the sequence above.** `/commit --pr` chains to `/create-pr`, whose final step invokes `/review-pr` → `scripts/pr-review.sh`, which posts findings as a PR comment marked `<!-- claude-review -->`. That marker is what `/triage-pr-comments` consumes; `/auto-implement` calls the same script directly. A PR opened with a raw `gh pr create` skips that first trigger, but the review is not lost: `/triage-pr-comments` step 2 runs the reviewer when the marker count is 0, and `/merge` step 2.5 does the same before merging (bypass with `/merge --force`). Invoke `/review-pr` directly only to re-review after a force-push, or to review a PR you didn't open.

**Other project skills:** `/chrome-review` (staging review on `wobblepot.dev`; needs `claude --chrome` or `/chrome`), `/tech-audit` (codebase audit, `--focus <area>` for one area), `/ideate` and `/refine-backlog` (issue writing), `/audit-ingredients`, `/bench-judge` (answers the judge pairs `pnpm ai-eval --judge` exports, on the subscription, and imports the verdicts; see [docs/AI_MODELS.md](docs/AI_MODELS.md)). Each skill's own description says when to use it.

**Vendor skills:** `better-auth-best-practices`, `create-auth-skill`, `next-best-practices`, `next-cache-components`, and `next-upgrade` are symlinks to `.agents/skills/*` — upstream references (Next.js / Better Auth) installed from skills.sh, not project rules. Where they conflict with this file, this file wins: Prisma adapter (not Drizzle), email/password only (no OAuth yet), pnpm with exact pins (no `@latest`, no `npm install`), TanStack Query for client reads (never `useEffect` + `fetch`), and the Next 16 upgrade guide (not v14/v15). Only `next-upgrade` is user-invocable; the rest are reference-only.

**Better Auth CLI:** the vendor skills tell you to run `npx @better-auth/cli@latest generate`. It does not work here (nor does its successor, `auth`): the CLI cannot load `src/lib/auth.ts`, so it is not a dependency of this repo. To pick up a Better Auth schema change, read the account/session/user/verification table definitions in `@better-auth/core/dist/db/get-tables.mjs` under `node_modules/.pnpm/` and diff them against `prisma/schema.prisma` by hand.

### Writing for Agents

Specs, plans, and issues are consumed by agents — coding agents (`/auto-implement`), but also product, design, and growth agents. Write for both:

- **Include the "why":** Agents need enough context and reasoning to make good judgment calls, not just a task list. State the problem, the user need, and key constraints.
- **Be explicit about the "what":** Reference file paths, function names, data shapes, and expected behavior. No vague descriptions an agent must guess at.
- **Be actionable:** Concrete, unambiguous steps. An agent should be able to execute without asking clarifying questions.
- **Define done:** Testable acceptance criteria — not "works correctly" but specific observable outcomes.
- **Self-check:** "Could an agent complete this from the issue alone, without the conversation that produced it?"

This applies to `/ideate`, `/refine-backlog`, `/plan-issue`, and any content that feeds into the agentic workflow.

**Do not nest a markdown table inside a list item in a Linear issue description.** Linear's parser silently strips the list item's content indent (3 characters under `1. `, 2 under `- `) off the front of every table _body_ cell, so `` `MealForm.tsx:153` `` becomes `` alForm.tsx:153` `` while the header row still looks right. That is data loss: the value an agent was told to use is gone, and nothing reports it. Put the table at top level before or after the list, or use a nested bullet list. Top-level tables and tables inside a blockquote are safe. Comment bodies are not affected today; hold the same discipline there, because plan content gets lifted into descriptions. Shape-by-shape results are on HON-617.

## Working style

**Verify from code + Linear before asking the user or asserting non-existence.** Before claiming "X doesn't exist" or asking the user about project setup (env, deploy, infra, existing features):

1. Read the relevant docs. The Documentation Structure and Reference tables are the map: `docs/DEPLOYMENT.md`, `docs/GIT_WORKFLOW.md`, `docs/ENVIRONMENT_SETUP.md`, `docs/PARALLEL_WORKFLOW.md`, and so on.
2. Check all plausible homes for the feature. A CSP header can live in `src/proxy.ts`, `next.config.ts` `headers()`, an edge-config file, or a custom server; don't generalise from one file.
3. Grep broadly for the feature name or a distinctive string (`grep -r "Content-Security-Policy"`). One wide grep beats several targeted reads.
4. If an issue references another (even as `relatedTo`), fetch the referenced issue with `includeRelations: true` and check `status` / `completedAt` / `attachments`. A "Done" status with an attached PR means the feature has shipped; don't reason about it as an active dependency.
5. If it is absent after all of the above, lead with "I checked X, Y, Z, grepped for Q, and looked up HON-NNN — no match" so the user can verify the coverage.

The failure this prevents: checking one file, finding nothing, generalising to "the feature doesn't exist", and then acting on it, for example by promoting a shipped issue to a blocker.

**Waiting inside a skill with a defined endpoint.** `/auto-implement`, `/implement-issue`, `/merge` and `/branch-review` end on their own (success, failure, or user input), so don't schedule a `ScheduleWakeup` as a fallback: it fires after the work has finished and re-runs the skill on stale state. To wait on CI, a build or a deploy, poll with **foreground wait-chunks**: a `Bash` call bounded under the 600 s cap that prints a terminal marker or a "still waiting" marker, re-issued until it goes terminal. Do not rely on a `run_in_background` completion notification. A headless worker (`wt auto`, no TTY) exits when its turn ends, so the notification has no session to land in and the backgrounded work dies with it. Backgrounding is fine for a command that outruns the cap, as long as the same turn then waits on its marker file in the foreground. See `.claude/skills/auto-implement/SKILL.md` → Execution Model. `ScheduleWakeup` is for real polling: `/loop`, or watching for an external state change such as a Linear issue moving to "In Review".

## Review Focus

- Flag actual bugs and logic errors
- Suggest improvements only if they have clear value
- Skip nitpicking on formatting (Prettier handles it)
- Ensure tests are meaningful and cover the changes
- Watch for TypeScript strictness violations

## Reference

The documents in the Documentation Structure table at the top, plus:

| Document                                               | Contents                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| [docs/TYPOGRAPHY.md](docs/TYPOGRAPHY.md)               | Full typography component guide with examples                                                                                |
| [docs/AI_VOICE_ET.md](docs/AI_VOICE_ET.md)             | Voice reference for Estonian text the AI produces                                                                            |
| [docs/AI_MODELS.md](docs/AI_MODELS.md)                 | Model IDs, the AI eval (`pnpm ai-eval`): check, compare, record the golden                                                   |
| [docs/FEATURE_FLAGS.md](docs/FEATURE_FLAGS.md)         | Feature flag pattern, kill-switches, fail-open semantics                                                                     |
| [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md)           | Branch workflow, recovery procedures                                                                                         |
| [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md) | Environment variable setup                                                                                                   |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)               | Production deployment process                                                                                                |
| [docs/SECURITY.md](docs/SECURITY.md)                   | Security headers and the Content Security Policy                                                                             |
| [docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md)             | Transactional email pipeline (Resend, DNS)                                                                                   |
| [docs/RUNBOOKS/](docs/RUNBOOKS/)                       | Breach notification, database recovery, DSR intake, GDPR deletion, Neon branch cleanup, status page, translation maintenance |
| [compliance/README.md](compliance/README.md)           | DPAs, the DPIA, subprocessors                                                                                                |
| [docs/MCP_SETUP.md](docs/MCP_SETUP.md)                 | MCP server configuration and troubleshooting                                                                                 |
| [docs/CHROME_TESTING.md](docs/CHROME_TESTING.md)       | Browser testing with Chrome extension                                                                                        |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

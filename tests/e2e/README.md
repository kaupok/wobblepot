# End-to-end tests

Playwright E2E specs for Honkadori. Three tiers run against different
environments, all from the same `tests/e2e/*.spec.ts` files.

## Tiers

| Tier              | When                                                                              | Target                           | Specs run                                 |
| ----------------- | --------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------- |
| **CI E2E**        | Every push / PR (`.github/workflows/ci.yml`)                                      | Docker Postgres sidecar          | All specs **except `@ai`**                |
| **Preview-smoke** | Vercel preview deploy succeeds **and PR has `smoke` label** (`preview-smoke.yml`) | Vercel preview URL + Neon branch | `--grep=@smoke` (fixture-based, no `@ai`) |
| **Staging-smoke** | Staging DB-migration workflow succeeds on `main` (`staging-smoke.yml`)            | `https://wobblepot.dev`          | `--grep=@smoke` (fixture-based, no `@ai`) |

Staging-smoke failure blocks production promotion — see
[`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md).

### Why the `@ai` split

Tier 1 runs on every push. Specs that call Claude (meal-plan generate,
swap, pantry-deduction) cost real money per run — at this repo's PR
velocity, running them on every push is a four-to-five-figure annual
bill. They are also excluded from tiers 2 and 3 (HON-560): every current
`@ai` spec creates its own account via `/api/e2e-seed`, which only exists
where the rate-limit bypass is active (CI/test/dev) — preview and staging
404 it by design. `@ai` specs run via `pnpm test:e2e:local --ai`.

### Running preview-smoke on a PR

Preview-smoke is **label-gated**: add the `smoke` label to the PR and
the next successful Vercel preview deploy triggers a smoke run against
it. Remove + re-add the label (or push a new commit) to re-trigger. The
workflow silently does nothing on unlabelled PRs — the "Smoke tests on
Vercel preview" check only appears once a run is actually dispatched.

## Running locally

**Use `pnpm test:e2e:local`.** It runs the suite against a throwaway,
fully-seeded **Neon branch** — never your dev database — then deletes the
branch on exit:

```bash
pnpm test:e2e:local                          # all specs EXCEPT @ai (cost-safe default)
pnpm test:e2e:local tests/e2e/foo.spec.ts    # one spec (runs @ai if that spec is tagged)
pnpm test:e2e:local --ai                     # the whole suite INCLUDING @ai specs
pnpm test:e2e:local --keep                   # leave the branch alive to inspect it
pnpm test:e2e:local -- --headed --debug      # forward args after `--` to playwright
pnpm test:e2e:local gc                        # delete orphaned e2e-local-* branches (crash recovery)
```

The wrapper (`scripts/e2e-local.sh`) forks an ephemeral branch off
`NEON_PARENT_BRANCH` (default `staging`), applies migrations, seeds it, and
starts a **dedicated dev server on port 3100** with `NEXT_PUBLIC_APP_ENV=test`
and `E2E_DISABLE_RATE_LIMIT=1`. Requires `NEON_API_KEY` + `NEON_PROJECT_ID` in
`.env` (the same ones the worktree workflow uses — see
[`docs/PARALLEL_WORKFLOW.md`](../../docs/PARALLEL_WORKFLOW.md)); `@ai` specs also
need `ANTHROPIC_API_KEY`. Because it runs on :3100 with its own server, a normal
`pnpm dev` on :3000 can keep running alongside it.

> **Why not just `pnpm test:e2e`?** That boots `pnpm dev`, which loads `.env`
> and talks to your **real dev database** — every sign-up, household, and meal
> plan a spec creates is written there for good (specs use unique emails, so the
> cruft is invisible but real), and `@ai` specs fail outright unless you hand-set
> the rate-limit bypass. Treat raw `pnpm test:e2e` as the advanced escape hatch:
> it uses whatever `DATABASE_URL` is in your environment, and reuses an existing
> :3000 server. Prefer `:local` for day-to-day runs.

To exercise the remote-URL wiring without a local server:

```bash
PLAYWRIGHT_BASE_URL=https://preview-xyz.vercel.app \
  pnpm test:e2e --grep=@smoke
```

## The `@smoke` tag

`@smoke` is a cluster-wide contract: specs carrying this tag run against
shared environments (preview, staging) and **must be idempotent**. In
principle that allows two shapes:

- (a) create scoped fixtures and clean up on teardown, or
- (b) operate on an immutable seeded account with read-only assertions.

In practice **pattern (b) is the only viable shape** (HON-560): account
creation needs an invite code from `/api/e2e-seed`, and that route 404s
everywhere the rate-limit bypass is off — staging AND preview, by design
(see `src/app/api/e2e-seed/route.ts`). A `@smoke` spec must therefore
never call `signUp()`, `signUpWithHousehold()`, or `seedInviteCode()`.
Sign in with the seeded fixture accounts below instead.

**Guardrail:** `scripts/check-smoke-specs.sh` fails CI (and the
staging-smoke run itself) if a `@smoke`-tagged spec file references one of
those helpers. The check is file-scoped, so keep staging-safe `@smoke`
specs in files that don't import the sign-up path — currently they all
live in `tests/e2e/smoke.spec.ts`.

The current `@smoke` set is:

- `tests/e2e/smoke.spec.ts` → `home renders with heading`
- `tests/e2e/smoke.spec.ts` → `seeded smoke user signs in and views profile`

(The original HON-455 locked set listed meal-plan and invite specs deleted
in the HON-518 drift audit; `pantry-deduction.spec.ts` lost `@smoke` in
HON-560 — it is `@ai` and seed-dependent.)

Upcoming `@smoke` specs (forgot-password and shopping→pantry via
[HON-479](https://linear.app/honkadori/issue/HON-479)) must follow the same
fixture-based convention. Do **not** add `@smoke` to destructive specs
(e.g. account deletion — ships CI-only via HON-479).

## Selector conventions

Specs must outlive cosmetic churn. The drift batch audited in [HON-518](https://linear.app/honkadori/issue/HON-518) — three whole spec files deleted because route removals, copy renames, and dialog restructures piled up silently — came from specs over-fitting to markup the product was always going to reshape.

Use these selectors, in order of preference:

- **`getByRole` + semantic `name`** is the default. It survives copy that moves between an `<h1>` and an `<h2>`, survives wrapping a `<button>` in a `<Tooltip>`, and fails fast when the accessible name changes (which is a real regression, not drift).
- **`getByLabel`** for form inputs. The label text is the user contract — if the label changes, the spec should notice.
- **`data-testid`** only when no accessible-name anchor exists (dynamic grids, icon-only buttons without `aria-label`). Treat each `data-testid` as a commitment: add it sparingly and keep it in the component, not the spec.
- **Plain text locators** (`getByText('Welcome back')`) are the most brittle — use them only for content that is itself the contract (landing-page hero, legal copy). Expect the spec to need an update when the copy changes.

Any `waitForTimeout` / ad-hoc `page.waitFor(ms)` is a smell — wait on real state (`waitForResponse`, `toBeVisible`, `toHaveURL`) instead.

## Spec header convention

Every `tests/e2e/*.spec.ts` file carries a single-line header comment as its first non-blank line:

```ts
// ROUTES: /a, /b · COMPONENTS: Foo, Bar
```

Format:

- `ROUTES:` — comma-separated list of URL pathnames the spec visits (including `/` for home). Parameterised routes use `:param` placeholders (e.g. `/meal-plans/:id`).
- `COMPONENTS:` — comma-separated list of React component names the spec exercises. Prefer the component's filename export (e.g. `SignUpForm`, not "the sign-up form"). Parenthetical qualifiers (e.g. `Header (User menu)`) are allowed when a single component hosts the assertion target.
- Separator: `·` (U+00B7 middle dot) between ROUTES and COMPONENTS.
- Keep it on one line so it stays grep-friendly — `grep -l 'ROUTES.*/profile' tests/e2e/` should cheaply return every spec that touches `/profile`.

The header is load-bearing for the drift-prevention workflow. `/plan-issue` and `/branch-review` use it to map a diff of `src/app/**/page.tsx` or modal components back to the specs that need updating in the same PR.

## Seed fixture contract

Preview-smoke and staging-smoke rely on fixtures the seed script plants when
`SEED_TEST_USERS=1` is set in the environment. These are consumed by specs
that follow pattern (b) — notably those landing via HON-469 and HON-479.

| Fixture                                               | How to reference                                                     | Purpose                                                                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke test user                                       | `SMOKE_TEST_EMAIL` + `SMOKE_TEST_PASSWORD`                           | Stable credential for read-only sign-in assertions                                                                                           |
| Smoke household ("Smoke Test Household")              | Automatic — owned by the smoke user                                  | Authed routes (`/`, `/profile`, `/shopping`) redirect household-less users to `/onboarding`; without it pattern (b) has nothing to assert on |
| Forgot-password test user                             | `FORGOT_PASSWORD_TEST_EMAIL` + `FORGOT_PASSWORD_TEST_PASSWORD`       | Password can be reset per run without cross-spec impact                                                                                      |
| Plan-eligible meal with concrete `quantityPerServing` | Any meal from `prisma/seed.ts` `baseMeals` with non-vague components | Drives pantry-deduction assertions                                                                                                           |

Seeded via `prisma/seed.ts` → `seedTestUsers()`. The function is **gated**
behind `SEED_TEST_USERS=1` so it never runs against production. Users are
upserted (idempotent) — re-running the seed is safe. Passwords are hashed
with `hashPassword` from `better-auth/crypto`, matching the runtime auth
path.

### Treat remote-tier artifacts as public

Playwright's page snapshot records `input.value` verbatim — including
`type="password"` fields, which the PNG screenshot correctly renders as dots.
So a failing preview-smoke / staging-smoke run had the fixture password sitting
in cleartext inside `error-context.md` and the trace, published as a 14-day
artifact that anyone with repo read access can download. GitHub's secret
masking only covers log output; it does not reach inside artifact files.

Two guards, both in place:

- `tests/e2e/reporters/redact-secrets.ts` — a reporter that scrubs the values of
  `SMOKE_TEST_*` / `FORGOT_PASSWORD_TEST_*` out of text attachments before the
  HTML reporter copies them. Listed first in `playwright.config.ts` because the
  HTML reporter reads those files in its `onEnd`. Add any new credential env var
  to its `SECRET_ENV_VARS` list.
- `playwright.config.ts` → `use.trace` — traces are `off` on remote tiers, since
  a zip carries the same values in a form the reporter cannot scrub. Local runs
  and the tier-1 build-and-run CI job are unaffected.

To debug a remote failure with a full trace, re-run with `E2E_KEEP_TRACES=1` and
treat the resulting artifact as credential-bearing.

Consequently: **these accounts must stay read-only and staging/preview-only.**
Never point `SMOKE_TEST_*` at an account that exists in the production database.

## Required GitHub Actions secrets

The `_CI` suffixed secrets can all reuse the same values as the matching
staging/prod env vars — they're only separate so you can rotate CI
independently if you ever want to. The test-user credentials are
purely content — but see "Treat remote-tier artifacts as public" above before
assuming they stay secret.

| Secret                          | Used by                      | Can reuse staging? | Notes                                                                                                                                                             |
| ------------------------------- | ---------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET_CI`         | CI                           | Yes                | Signs sessions in the CI runner. Sessions are DB-backed — a leaked secret can't forge a session without the matching DB row, so sharing is benign.                |
| `ANTHROPIC_API_KEY_CI`          | CI                           | Yes                | Tier 1 skips `@ai` specs so runtime AI spend is effectively zero. The key is still needed for `pnpm build` to resolve lazy env references cleanly. Reuse staging. |
| `UPSTASH_REDIS_REST_URL_CI`     | CI                           | Yes                | Same Upstash DB as staging. Rate-limiter keys are dimensioned (ip/household/user) and CI runner IPs / fresh IDs don't collide with real traffic.                  |
| `UPSTASH_REDIS_REST_TOKEN_CI`   | CI                           | Yes                | Paired with above.                                                                                                                                                |
| `SMOKE_TEST_EMAIL`              | CI / preview-smoke / staging | n/a                | Stable seeded account. Pick any value — e.g. `smoke+ci@wobblepot.dev`.                                                                                            |
| `SMOKE_TEST_PASSWORD`           | CI / preview-smoke / staging | n/a                | ≥ 12 chars (HON-464 minimum) and must not be in HIBP's breach list (auth.ts rejects known-breached passwords on sign-up).                                         |
| `FORGOT_PASSWORD_TEST_EMAIL`    | CI / preview-smoke / staging | n/a                | Separate seeded account so reset-password specs don't affect the smoke account.                                                                                   |
| `FORGOT_PASSWORD_TEST_PASSWORD` | CI / preview-smoke / staging | n/a                | Same constraints as `SMOKE_TEST_PASSWORD`.                                                                                                                        |

Where each environment's seed actually runs (and therefore where the
`SEED_TEST_USERS=1` + credential env vars must be set):

- **Preview** — `scripts/maybe-migrate.sh` → `pnpm db:seed` during the
  Vercel build, so the **Vercel preview env vars** need `SEED_TEST_USERS=1`
  plus the same `SMOKE_TEST_*` / `FORGOT_PASSWORD_TEST_*` values.
- **Staging** — `maybe-migrate.sh` skips `main`, so seeding happens in the
  `Deploy DB migrations [staging]` GitHub workflow instead. Its seed step
  sets `SEED_TEST_USERS=1` and passes the four credential secrets
  (HON-560). The step only runs when `prisma/seed*.ts` / `schema.prisma`
  changed in the push — `workflow_dispatch` the migration workflow to
  re-seed on demand.

Missing env vars don't error — `seedTestUsers()` silently no-ops, and the
fixture sign-in spec then fails on the remote tier (it fails loudly rather
than skipping when `PLAYWRIGHT_BASE_URL` is set, precisely so a missing
secret can't turn the promotion gate into a silent green).

`STAGING_URL` is a **variable** (not a secret) — default `https://wobblepot.dev`.

## File layout

| File                              | Purpose                                         |
| --------------------------------- | ----------------------------------------------- |
| `tests/e2e/*.spec.ts`             | Specs                                           |
| `tests/e2e/utils/test-helpers.ts` | Shared helpers (sign-up, sign-in, meal-plan)    |
| `playwright.config.ts`            | Top-level config (CI-aware webServer + baseURL) |

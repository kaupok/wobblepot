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
starts a **dedicated dev server on port 3100** with `NEXT_PUBLIC_APP_ENV=test`,
`E2E_DISABLE_RATE_LIMIT=1` and `SIGNUP_TIMING_LOG=1` (per-step sign-up timings
appear as `[WebServer] [signup-timing] step=… ms=…` lines — HON-569). A
`globalSetup` warm-up pre-compiles the auth-critical routes on local dev
servers before the workers start (`tests/e2e/utils/warm-dev-server.ts`). Requires `NEON_API_KEY` + `NEON_PROJECT_ID` in
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

The hard constraint (HON-560): **account creation is off-limits.** It needs
an invite code from `/api/e2e-seed`, and that route 404s everywhere the
rate-limit bypass is off — staging AND preview, by design (see
`src/app/api/e2e-seed/route.ts`). A `@smoke` spec must therefore never call
`signUp()`, `signUpWithHousehold()`, or `seedInviteCode()`. Sign in with the
seeded fixture accounts below instead. The same 404 applies to the
`/api/e2e-support` back-channel (below), so a `@smoke` spec may only use that
as a fallback that degrades to `test.skip` — never as its primary path.

Within that constraint both shapes are allowed. Pattern (b) is the default;
pattern (a) is legitimate when the behaviour under test is inherently
stateful, as long as the fixture is scoped to a seeded household and torn
down in a `finally`. `shopping-to-pantry.spec.ts` is the worked example: it
creates one meal-plan entry against the seeded smoke household, drives the
purchase toggle, and deletes the entry (and any pantry row) whatever happens.

**Guardrail:** `scripts/check-smoke-specs.sh` fails CI (and the
staging-smoke run itself) if a `@smoke`-tagged spec file references one of
the sign-up helpers. The check is file-scoped, so keep staging-safe `@smoke`
specs in files that don't import the sign-up path.

The current `@smoke` set is:

- `tests/e2e/smoke.spec.ts` → `home renders with heading`
- `tests/e2e/smoke.spec.ts` → `seeded smoke user signs in and views profile`
- `tests/e2e/security-headers.spec.ts` → `home response carries a nonce-based CSP` (HON-561; no sign-in, no seed — asserts the proxy (`src/proxy.ts`) ran on a real response)
- `tests/e2e/shopping-to-pantry.spec.ts` → `marking an item purchased moves it to the pantry, un-purchasing returns it` (HON-479; pattern (a), self-cleaning)
- `tests/e2e/forgot-password.spec.ts` → `request reset → set a new password → sign in with it` (HON-479; **skips unless a reset link is readable** — see "Reading email in specs")

(The original HON-455 locked set listed meal-plan and invite specs deleted
in the HON-518 drift audit; `pantry-deduction.spec.ts` lost `@smoke` in
HON-560 — it is `@ai` and seed-dependent.)

Do **not** add `@smoke` to destructive specs. `tests/e2e/account-deletion.spec.ts`
(HON-479) is the standing example: it signs up a throwaway account, hard-deletes
rows, and needs the back-channel, so it runs in tier 1 CI and locally only.

## Test-only routes

Two routes exist purely for E2E, both gated on `RATE_LIMIT_BYPASS_ACTIVE`
(`E2E_DISABLE_RATE_LIMIT=1` **and** `NEXT_PUBLIC_APP_ENV` of `ci`/`test`/`dev`)
and returning **404** everywhere else — production, staging and preview included:

| Route              | Purpose                                                                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/e2e-seed`    | Mints a single-use invite code for the HON-488 sign-up gate.                                                                                                                                                                                                   |
| `/api/e2e-support` | Back-channel for state Playwright can't reach through the UI (HON-479): `?action=reset-token`, `?action=user-state`, `?action=household-state`, and `POST ?action=expire-purge` (back-dates `purgeScheduledFor` so the purge cron sees the window as elapsed). |

`expire-purge` exists so the **production** cron route stays free of test-only
branches: the account-deletion spec back-dates the timestamp, then calls
`/api/cron/purge-deleted-users` for real with `CRON_SECRET`. That secret is a
fixed literal in `.github/workflows/ci.yml` and `scripts/e2e-local.sh` — both
sides of the bearer check live inside the test environment, so it is content,
not a credential.

Use the typed client in `tests/e2e/utils/e2e-support.ts` rather than raw
`fetch`, so a route rename breaks in one place.

## Reading email in specs

Specs that need to read outbound mail (`forgot-password`, and the optional
email assertion in `account-deletion`) go through
`tests/e2e/utils/mail-helpers.ts`, which has two backends:

1. **Resend** — set `RESEND_TEST_API_KEY` to a _read-capable_ Resend API key on
   the same team the app sends from. The helper polls `GET /emails`, matches on
   recipient + subject + a send-time lower bound, then pulls the body with
   `GET /emails/{id}`. This is the only backend that works on preview and
   staging, where the app really sends mail.
2. **Back-channel** — tier 1 CI and `pnpm test:e2e:local` have no
   `RESEND_API_KEY` at all, so `sendResetPassword` short-circuits and no email
   is ever produced. There the helper reads the token from
   `/api/e2e-support?action=reset-token` and rebuilds Better Auth's own
   `/api/auth/reset-password/:token` link, so everything from the click onwards
   is the real flow.

With neither available, `forgot-password.spec.ts` **skips**. That is
deliberate: `RESEND_TEST_API_KEY` has to be minted by a human, and failing hard
in the meantime would leave the production-promotion gate red on every merge —
the exact failure HON-560 fixed. Provisioning the key is what turns this spec
on for tiers 2 and 3.

## Selector conventions

Specs must outlive cosmetic churn. The drift batch audited in [HON-518](https://linear.app/honkadori/issue/HON-518) — three whole spec files deleted because route removals, copy renames, and dialog restructures piled up silently — came from specs over-fitting to markup the product was always going to reshape.

Use these selectors, in order of preference:

- **`getByRole` + semantic `name`** is the default. It survives copy that moves between an `<h1>` and an `<h2>`, survives wrapping a `<button>` in a `<Tooltip>`, and fails fast when the accessible name changes (which is a real regression, not drift).
- **`getByLabel`** for form inputs. The label text is the user contract — if the label changes, the spec should notice.
- **`data-testid`** only when no accessible-name anchor exists (dynamic grids, icon-only buttons without `aria-label`). Treat each `data-testid` as a commitment: add it sparingly and keep it in the component, not the spec.
- **Plain text locators** (`getByText('Welcome back')`) are the most brittle — use them only for content that is itself the contract (landing-page hero, legal copy). Expect the spec to need an update when the copy changes.

### `role="status"` is not a selector

`getByRole('status')` looks like the ideal role query for a success banner, and it is a trap. The `Skeleton` primitive (`src/components/ui/skeleton.tsx`) renders `role="status"` on **every** loader, so an unscoped query matches whatever `loading.tsx` is on screen — seven elements on `/sign-in`, nine on the root segment. Playwright then raises a strict-mode violation instead of waiting for the banner, and the spec passes only when the banner wins the race ([HON-582](https://linear.app/honkadori/issue/HON-582)).

Target the banner's own handle instead. Both auth forms expose `data-testid="form-success"` on their `role="status"` banner, pinned by a unit test in each form's `.test.tsx`:

```ts
await expect(page.getByTestId('form-success')).toContainText(/password has been reset/i)
```

This is the sanctioned exception to the "`data-testid` only when no accessible-name anchor exists" rule above — a live region's accessible name _is_ its content, so there is no name to anchor on, and the competing elements share its role. Do **not** reach for `.first()` / `.last()` to break the tie: that trades a loud failure for a silent assertion against the wrong element.

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

| Fixture                                               | How to reference                                                     | Purpose                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke test user                                       | `SMOKE_TEST_EMAIL` + `SMOKE_TEST_PASSWORD`                           | Stable credential for read-only sign-in assertions                                                                                                                                                                                                                                                            |
| Smoke household ("Smoke Test Household")              | Automatic — owned by the smoke user                                  | Authed routes (`/`, `/profile`, `/shopping`) redirect household-less users to `/onboarding`; without it pattern (b) has nothing to assert on                                                                                                                                                                  |
| Smoke household meal plan                             | Automatic — `ensureSmokeMealPlan()`                                  | An empty `MealPlan` container. `MealPlan` is dateless (`@@unique([householdId])`), so it never goes stale; `shopping-to-pantry.spec.ts` hangs its own dated entry off it. Deliberately **no** seeded entries — a fixed date would drop out of the 7-day rolling window within a week and redden staging-smoke |
| Forgot-password test user                             | `FORGOT_PASSWORD_TEST_EMAIL` + `FORGOT_PASSWORD_TEST_PASSWORD`       | Password can be reset per run without cross-spec impact. Has **no household** on purpose — it never navigates past sign-in, so signed-in assertions use the session endpoint, not `/profile`                                                                                                                  |
| Plan-eligible meal with concrete `quantityPerServing` | Any meal from `prisma/seed.ts` `baseMeals` with non-vague components | Drives pantry-deduction assertions                                                                                                                                                                                                                                                                            |

Seeded via `prisma/seed.ts` → `seedTestUsers()`. The function is **gated**
behind `SEED_TEST_USERS=1` so it never runs against production. Users are
upserted (idempotent) — re-running the seed is safe. Passwords are hashed
with `hashPassword` from `better-auth/crypto`, matching the runtime auth
path.

### Treat remote-tier artifacts as public

A failing preview-smoke / staging-smoke run used to publish the fixture
password in cleartext, as a 14-day artifact anyone with repo read access could
download. GitHub's secret masking only covers log output; it does not reach
inside artifact files. Both leaks below were confirmed by unzipping a real
staging-smoke artifact:

1. **Page snapshot** — Playwright records `input.value` verbatim, including
   `type="password"` fields that the PNG screenshot correctly renders as dots.
   Lands in `error-context.md` and inside the trace.
2. **Trace network log** — `0-trace.network` carries full request bodies, so the
   sign-in POST payload holds the password independently of the snapshot.

Two guards, both in place:

- `tests/e2e/reporters/redact-secrets.ts` — a reporter that scrubs the values of
  `SMOKE_TEST_*` / `FORGOT_PASSWORD_TEST_*` out of text attachments before the
  HTML reporter copies them. Listed first in `playwright.config.ts` because the
  HTML reporter reads those files in its `onEnd`. Add any new credential env var
  to its `SECRET_ENV_VARS` list.
- `playwright.config.ts` → `use.trace` — traces are `off` on remote tiers. This
  is what closes leak (2): a zip cannot be text-scrubbed. Local runs and the
  tier-1 build-and-run CI job are unaffected.

To debug a remote failure with a full trace, re-run with `E2E_KEEP_TRACES=1`.
The result is credential-bearing: keep it local, don't upload it as a CI
artifact, and delete it when you're done.

Consequently: **these accounts must stay read-only and staging/preview-only.**
Never point `SMOKE_TEST_*` at an account that exists in the production database.

## Required GitHub Actions secrets

The `_CI` suffixed secrets can all reuse the same values as the matching
staging/prod env vars — they're only separate so you can rotate CI
independently if you ever want to. The test-user credentials are
purely content — but see "Treat remote-tier artifacts as public" above before
assuming they stay secret.

| Secret                          | Used by                      | Can reuse staging?  | Notes                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ---------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET_CI`         | CI                           | Yes                 | Signs sessions in the CI runner. Sessions are DB-backed — a leaked secret can't forge a session without the matching DB row, so sharing is benign.                                                                                                                                                  |
| `ANTHROPIC_API_KEY_CI`          | CI                           | Yes                 | Tier 1 skips `@ai` specs so runtime AI spend is effectively zero. The key is still needed for `pnpm build` to resolve lazy env references cleanly. Reuse staging.                                                                                                                                   |
| `UPSTASH_REDIS_REST_URL_CI`     | CI                           | Yes                 | Same Upstash DB as staging. Rate-limiter keys are dimensioned (ip/household/user) and CI runner IPs / fresh IDs don't collide with real traffic.                                                                                                                                                    |
| `UPSTASH_REDIS_REST_TOKEN_CI`   | CI                           | Yes                 | Paired with above.                                                                                                                                                                                                                                                                                  |
| `SMOKE_TEST_EMAIL`              | CI / preview-smoke / staging | n/a                 | Stable seeded account. Pick any value — e.g. `smoke+ci@wobblepot.dev`.                                                                                                                                                                                                                              |
| `SMOKE_TEST_PASSWORD`           | CI / preview-smoke / staging | n/a                 | ≥ 12 chars (HON-464 minimum) and must not be in HIBP's breach list (auth.ts rejects known-breached passwords on sign-up).                                                                                                                                                                           |
| `FORGOT_PASSWORD_TEST_EMAIL`    | CI / preview-smoke / staging | n/a                 | Separate seeded account so reset-password specs don't affect the smoke account.                                                                                                                                                                                                                     |
| `FORGOT_PASSWORD_TEST_PASSWORD` | CI / preview-smoke / staging | n/a                 | Same constraints as `SMOKE_TEST_PASSWORD`.                                                                                                                                                                                                                                                          |
| `RESEND_TEST_API_KEY`           | preview-smoke / staging      | No — mint a new one | **Not provisioned yet.** A _read-capable_ Resend API key on the same team the app sends from, used by the Playwright runner (never by the app) to fetch delivered mail. Until it exists, `forgot-password.spec.ts` skips on tiers 2/3. Distinct from `RESEND_API_KEY`, which is the app's send key. |

Where each environment's seed actually runs (and therefore where the
`SEED_TEST_USERS=1` + credential env vars must be set):

- **Preview** — nothing seeds during the Vercel build: `scripts/maybe-migrate.sh`
  runs `prisma migrate deploy` and nothing else. A preview Neon branch is a
  copy-on-write fork of its parent, so the fixtures it has are the ones the
  parent branch already held — i.e. whatever the staging seed below planted.
  A fixture added to `seedTestUsers()` only reaches preview once the staging
  seed has run and new preview branches fork from the updated parent.
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

| File                              | Purpose                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| `tests/e2e/*.spec.ts`             | Specs                                                                   |
| `tests/e2e/utils/test-helpers.ts` | Shared helpers (sign-up, sign-in, meal-plan)                            |
| `tests/e2e/utils/db-helpers.ts`   | `/api/e2e-seed` client + `e2eBaseURL()`                                 |
| `tests/e2e/utils/e2e-support.ts`  | `/api/e2e-support` back-channel client + purge-cron trigger             |
| `tests/e2e/utils/fixtures.ts`     | Seeded-fixture credentials (skip locally / fail loudly on remote tiers) |
| `tests/e2e/utils/mail-helpers.ts` | Reading outbound email (Resend backend, back-channel fallback)          |
| `playwright.config.ts`            | Top-level config (CI-aware webServer + baseURL)                         |

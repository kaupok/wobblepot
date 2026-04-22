# End-to-end tests

Playwright E2E specs for Honkadori. Three tiers run against different
environments, all from the same `tests/e2e/*.spec.ts` files.

## Tiers

| Tier              | When                                                                              | Target                           | Specs run                     |
| ----------------- | --------------------------------------------------------------------------------- | -------------------------------- | ----------------------------- |
| **CI E2E**        | Every push / PR (`.github/workflows/ci.yml`)                                      | Docker Postgres sidecar          | All specs **except `@ai`**    |
| **Preview-smoke** | Vercel preview deploy succeeds **and PR has `smoke` label** (`preview-smoke.yml`) | Vercel preview URL + Neon branch | `--grep=@smoke` (includes AI) |
| **Staging-smoke** | Staging DB-migration workflow succeeds on `main` (`staging-smoke.yml`)            | `https://honkadori.xyz`          | `--grep=@smoke` (includes AI) |

Staging-smoke failure blocks production promotion — see
[`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md).

### Why the `@ai` split

Tier 1 runs on every push. Specs that call Claude (meal-plan generate,
swap, pantry-deduction) cost real money per run — at this repo's PR
velocity, running them on every push is a four-to-five-figure annual
bill. They live in tiers 2 and 3 instead, where "once per PR" and "once
per merge" cadences are economically reasonable.

### Running preview-smoke on a PR

Preview-smoke is **label-gated**: add the `smoke` label to the PR and
the next successful Vercel preview deploy triggers a smoke run against
it. Remove + re-add the label (or push a new commit) to re-trigger. The
workflow silently does nothing on unlabelled PRs — the "Smoke tests on
Vercel preview" check only appears once a run is actually dispatched.

## Running locally

```bash
pnpm test:e2e                       # Full suite against local dev server
pnpm test:e2e --grep=@smoke         # Just smoke specs (what tiers 2+3 run)
pnpm test:e2e --grep-invert=@ai     # What tier 1 runs — no Claude calls
```

To exercise the remote-URL wiring without a local server:

```bash
PLAYWRIGHT_BASE_URL=https://preview-xyz.vercel.app \
  pnpm test:e2e --grep=@smoke
```

## The `@smoke` tag

`@smoke` is a cluster-wide contract: specs carrying this tag run against
shared environments (preview, staging) and **must be idempotent**. They
either:

- (a) create scoped fixtures and clean up on teardown, or
- (b) operate on an immutable seeded account with read-only assertions.

The locked initial `@smoke` set is:

- `tests/e2e/auth.spec.ts` → `sign in -> view profile`
- `tests/e2e/meal-plan.spec.ts` → `generate first meal plan`
- `tests/e2e/meal-plan.spec.ts` → `change meal status persists after refresh`
- `tests/e2e/invite.spec.ts` → `new user accepts invite and joins household`
- `tests/e2e/pantry-deduction.spec.ts` → `marking a meal completed decrements pantry…`

Do **not** add `@smoke` to destructive specs (e.g. account deletion —
ships CI-only via [HON-479](https://linear.app/honkadori/issue/HON-479)).

## Seed fixture contract

Preview-smoke and staging-smoke rely on fixtures the seed script plants when
`SEED_TEST_USERS=1` is set in the environment. These are consumed by specs
that follow pattern (b) — notably those landing via HON-469 and HON-479.

| Fixture                                               | How to reference                                                     | Purpose                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| Smoke test user                                       | `SMOKE_TEST_EMAIL` + `SMOKE_TEST_PASSWORD`                           | Stable credential for read-only sign-in assertions      |
| Forgot-password test user                             | `FORGOT_PASSWORD_TEST_EMAIL` + `FORGOT_PASSWORD_TEST_PASSWORD`       | Password can be reset per run without cross-spec impact |
| Plan-eligible meal with concrete `quantityPerServing` | Any meal from `prisma/seed.ts` `baseMeals` with non-vague components | Drives pantry-deduction assertions                      |

Seeded via `prisma/seed.ts` → `seedTestUsers()`. The function is **gated**
behind `SEED_TEST_USERS=1` so it never runs against production. Users are
upserted (idempotent) — re-running the seed is safe. Passwords are hashed
with `hashPassword` from `better-auth/crypto`, matching the runtime auth
path.

## Required GitHub Actions secrets

The `_CI` suffixed secrets can all reuse the same values as the matching
staging/prod env vars — they're only separate so you can rotate CI
independently if you ever want to. The test-user credentials are
purely content.

| Secret                          | Used by                      | Can reuse staging? | Notes                                                                                                                                                             |
| ------------------------------- | ---------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET_CI`         | CI                           | Yes                | Signs sessions in the CI runner. Sessions are DB-backed — a leaked secret can't forge a session without the matching DB row, so sharing is benign.                |
| `ANTHROPIC_API_KEY_CI`          | CI                           | Yes                | Tier 1 skips `@ai` specs so runtime AI spend is effectively zero. The key is still needed for `pnpm build` to resolve lazy env references cleanly. Reuse staging. |
| `UPSTASH_REDIS_REST_URL_CI`     | CI                           | Yes                | Same Upstash DB as staging. Rate-limiter keys are dimensioned (ip/household/user) and CI runner IPs / fresh IDs don't collide with real traffic.                  |
| `UPSTASH_REDIS_REST_TOKEN_CI`   | CI                           | Yes                | Paired with above.                                                                                                                                                |
| `SMOKE_TEST_EMAIL`              | CI / preview-smoke / staging | n/a                | Stable seeded account. Pick any value — e.g. `smoke+ci@honkadori.xyz`.                                                                                            |
| `SMOKE_TEST_PASSWORD`           | CI / preview-smoke / staging | n/a                | ≥ 12 chars (HON-464 minimum) and must not be in HIBP's breach list (auth.ts rejects known-breached passwords on sign-up).                                         |
| `FORGOT_PASSWORD_TEST_EMAIL`    | CI / preview-smoke / staging | n/a                | Separate seeded account so reset-password specs don't affect the smoke account.                                                                                   |
| `FORGOT_PASSWORD_TEST_PASSWORD` | CI / preview-smoke / staging | n/a                | Same constraints as `SMOKE_TEST_PASSWORD`.                                                                                                                        |

For preview-smoke and staging-smoke to actually find the seeded
accounts, the **Vercel env vars** for those environments also need
`SEED_TEST_USERS=1` plus the same `SMOKE_TEST_*` / `FORGOT_PASSWORD_TEST_*`
values — otherwise the seed step `scripts/maybe-migrate.sh` → `pnpm db:seed`
skips the `seedTestUsers()` branch.

`STAGING_URL` is a **variable** (not a secret) — default `https://honkadori.xyz`.

## File layout

| File                              | Purpose                                         |
| --------------------------------- | ----------------------------------------------- |
| `tests/e2e/*.spec.ts`             | Specs                                           |
| `tests/e2e/utils/test-helpers.ts` | Shared helpers (sign-up, sign-in, meal-plan)    |
| `playwright.config.ts`            | Top-level config (CI-aware webServer + baseURL) |

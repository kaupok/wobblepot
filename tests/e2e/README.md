# End-to-end tests

Playwright E2E specs for Honkadori. Three tiers run against different
environments, all from the same `tests/e2e/*.spec.ts` files.

## Tiers

| Tier              | When                                                                   | Target                           | Specs run            |
| ----------------- | ---------------------------------------------------------------------- | -------------------------------- | -------------------- |
| **CI E2E**        | Every push / PR (`.github/workflows/ci.yml`)                           | Docker Postgres sidecar          | All specs            |
| **Preview-smoke** | Vercel preview deploy succeeds (`preview-smoke.yml`)                   | Vercel preview URL + Neon branch | `--grep=@smoke` only |
| **Staging-smoke** | Staging DB-migration workflow succeeds on `main` (`staging-smoke.yml`) | `https://honkadori.xyz`          | `--grep=@smoke` only |

Staging-smoke failure blocks production promotion — see
[`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md).

## Running locally

```bash
pnpm test:e2e              # Full suite against local dev server
pnpm test:e2e --grep=@smoke # Just the smoke specs
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

| Secret                          | Used by                      | Notes                                                        |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------ |
| `BETTER_AUTH_SECRET_CI`         | CI                           | `openssl rand -base64 32`                                    |
| `ANTHROPIC_API_KEY_CI`          | CI                           | Dedicated low-budget key; meal-plan spec invokes AI          |
| `UPSTASH_REDIS_REST_URL_CI`     | CI                           | Throwaway Upstash DB — rate-limiter state isolated from prod |
| `UPSTASH_REDIS_REST_TOKEN_CI`   | CI                           | Paired with above                                            |
| `SMOKE_TEST_EMAIL`              | CI / preview-smoke / staging | Seed + helper credential                                     |
| `SMOKE_TEST_PASSWORD`           | CI / preview-smoke / staging | Must be ≥ 12 chars (HON-464 minimum)                         |
| `FORGOT_PASSWORD_TEST_EMAIL`    | CI / preview-smoke / staging | Seed + helper credential                                     |
| `FORGOT_PASSWORD_TEST_PASSWORD` | CI / preview-smoke / staging | Must be ≥ 12 chars                                           |

`STAGING_URL` is a **variable** (not a secret) — default `https://honkadori.xyz`.

## File layout

| File                              | Purpose                                         |
| --------------------------------- | ----------------------------------------------- |
| `tests/e2e/*.spec.ts`             | Specs                                           |
| `tests/e2e/utils/test-helpers.ts` | Shared helpers (sign-up, sign-in, meal-plan)    |
| `playwright.config.ts`            | Top-level config (CI-aware webServer + baseURL) |

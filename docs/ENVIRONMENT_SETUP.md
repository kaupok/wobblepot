# Environment Variables Setup Guide

Complete guide for setting up and managing environment variables in the Honkadori project.

## Table of Contents

- [Overview](#overview)
- [Initial Setup](#initial-setup)
- [Variable reference](#variable-reference)
- [Special Characters in Values](#special-characters-in-values)
- [Adding New Environment Variables](#adding-new-environment-variables)
  - [Adding a Public Variable](#adding-a-public-variable-next_public_)
  - [Adding a Server-Only Variable](#adding-a-server-only-variable)
- [Email Service (Resend)](#email-service-resend)
- [Upstash Redis (rate limiting)](#upstash-redis-rate-limiting)
- [PostHog (analytics, errors, source maps)](#posthog-analytics-errors-source-maps)
- [Neon Database Branching](#neon-database-branching-optional)
- [Cron secret (account-deletion purge)](#cron-secret-account-deletion-purge)
- [Admin email](#admin-email)
- [Application URL](#application-url)
- [Diagnostics and test-only switches](#diagnostics-and-test-only-switches)
- [Validation](#validation)
- [Drift audit](#drift-audit-pnpm-envaudit)
- [Usage in Code](#usage-in-code)

## Overview

Environment variables are validated at runtime using Zod. This ensures all required configuration is present and correctly formatted before the app starts.

**Important:** We use separate validation for client and server environments to prevent accidentally exposing server-only secrets to the client bundle.

## Initial Setup

1. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. Fill in required values in `.env` (never commit this file - already in .gitignore). The [variable reference](#variable-reference) below says which ones are required and what each does.

3. Environment validation happens automatically on app startup in `src/lib/env.ts`

## Variable reference

`src/lib/env.ts` is the source of truth: every variable the app reads is declared there with a Zod schema and a `.describe()` string. This table mirrors it so you can see the whole surface in one place. "Required" means the schema has no `.optional()`; server-only variables are validated lazily, on first access, so a missing one fails the feature that needs it rather than the boot.

| Variable                                                            | Required             | What it does                                                                                                                                                   |
| ------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_NAME`                                              | Yes                  | Display name shown in the UI and email subjects.                                                                                                               |
| `NEXT_PUBLIC_APP_ENV`                                               | Yes                  | One of `dev`, `preview`, `staging`, `production`, `ci`, `test`. Drives email subject prefixes, the rate-limit bypass allowlist, and PostHog project selection. |
| `NEXT_PUBLIC_APP_URL`                                               | No                   | Base URL override. See [Application URL](#application-url) for the fallback order.                                                                             |
| `NEXT_PUBLIC_POSTHOG_KEY`                                           | No                   | PostHog project token. Unset disables PostHog entirely. See [PostHog](#posthog-analytics-errors-source-maps).                                                  |
| `NEXT_PUBLIC_POSTHOG_HOST`                                          | No                   | PostHog ingest host, identical across environments.                                                                                                            |
| `BETTER_AUTH_SECRET`                                                | Yes                  | Session signing secret, at least 32 characters. `openssl rand -base64 32`.                                                                                     |
| `DATABASE_URL`                                                      | Yes                  | Pooled Neon connection. Read by the app at runtime through the Prisma adapter.                                                                                 |
| `DATABASE_URL_UNPOOLED`                                             | Yes                  | Direct Neon connection. Read by the Prisma CLI (`db:push`, `db:migrate`, `db:seed`) through `prisma.config.ts`, and by the migration workflows.                |
| `ANTHROPIC_API_KEY`                                                 | Yes, for AI features | Every Claude call: meal generation, imagined meals, recipe import, prep tips. Pages that do not call the AI boot without it.                                   |
| `RESEND_API_KEY`                                                    | No                   | Transactional email. Unset logs the password-reset URL to the console instead. See [Email Service](#email-service-resend).                                     |
| `UPSTASH_REDIS_REST_URL`                                            | Yes                  | Rate limiting. See [Upstash Redis](#upstash-redis-rate-limiting).                                                                                              |
| `UPSTASH_REDIS_REST_TOKEN`                                          | Yes                  | Rate limiting.                                                                                                                                                 |
| `ADMIN_EMAIL`                                                       | Yes, for `/admin`    | The single beta admin. See [Admin email](#admin-email).                                                                                                        |
| `CRON_SECRET`                                                       | Production only      | Authenticates the account-deletion purge cron. See [Cron secret](#cron-secret-account-deletion-purge).                                                         |
| `STATUS_INCIDENT_MESSAGE`                                           | No                   | Operator banner on `/status` during an incident. See [Diagnostics and test-only switches](#diagnostics-and-test-only-switches).                                |
| `E2E_DISABLE_RATE_LIMIT`                                            | No, test-only        | Bypasses the abuse rate limiter for E2E runs. Only honoured when `NEXT_PUBLIC_APP_ENV` is `ci`, `test`, or `dev`; throws at boot anywhere else.                |
| `SIGNUP_TIMING_LOG`                                                 | No, diagnostics      | Logs per-step sign-up timings to stderr. Set by the local E2E runner.                                                                                          |
| `POSTHOG_CLI_HOST`, `POSTHOG_CLI_PROJECT_ID`, `POSTHOG_CLI_API_KEY` | No, build-time       | Source-map upload from the Vercel build. Unset locally. See [PostHog](#posthog-analytics-errors-source-maps).                                                  |

Variables read by scripts rather than the app, so not in the schema. They are documented in `.env.example`:

| Variable                                                                    | Read by                                                                                                                     |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `LINEAR_API_KEY`                                                            | `scripts/orchestrator.sh`, `scripts/worktree-claude.sh`, `scripts/neon-cleanup.sh`                                          |
| `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_PARENT_BRANCH`, `NEON_USER_PREFIX` | Per-worktree database branching and the local E2E runner. See [Neon Database Branching](#neon-database-branching-optional). |
| `RESEND_TEST_API_KEY`                                                       | The Playwright runner, to read delivered reset emails on the remote tiers.                                                  |
| `POSTHOG_CAPTURE_LOCAL`                                                     | `src/lib/release.ts`, an escape hatch to force server-side capture from a dev machine. Leave unset.                         |

## Special Characters in Values

**Important:** Always wrap environment variable values containing special shell characters (`&`, `?`, `=`, etc.) in double quotes:

```bash
# ❌ Wrong - shell will parse & as a command separator
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require&channel_binding=require

# ✅ Correct - quotes prevent shell parsing issues
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require&channel_binding=require"
```

This is critical for database URLs and other values with query parameters. Without quotes, shell scripts that source `.env` (like `health-check.sh`) will fail to parse these variables correctly.

## Adding New Environment Variables

### Adding a Public Variable (NEXT*PUBLIC*\*)

Public variables are accessible in both client and server code.

1. Add to `clientEnvSchema` in `src/lib/env.ts`:

   ```typescript
   export const clientEnvSchema = z.object({
     // ... existing vars
     NEXT_PUBLIC_MY_VAR: z.string().optional(),
   })
   ```

2. Document in `.env.example` with description

3. Use via `clientEnv` in your code:

   ```typescript
   import { clientEnv } from '@/lib/env'

   // Type-safe access to public env vars
   console.log(clientEnv.NEXT_PUBLIC_MY_VAR)
   ```

### Adding a Server-Only Variable

Server-only variables are only accessible in server-side code (API routes, Server Components).

1. Add to `serverEnvSchema` in `src/lib/env.ts`:

   ```typescript
   export const serverEnvSchema = clientEnvSchema.extend({
     // ... existing vars
     MY_SERVER_SECRET: z.string(),
   })
   ```

2. Document in `.env.example` (clearly mark as server-only)

3. Use via `serverEnv` in server-side code only:

   ```typescript
   import { serverEnv } from '@/lib/env'

   // Access both public and server-only vars
   console.log(serverEnv.NEXT_PUBLIC_APP_NAME) // Also available
   console.log(serverEnv.MY_SERVER_SECRET) // Server-only
   ```

**Never import `serverEnv` in client components** - it will throw a helpful error if accessed in the browser.

## Email Service (Resend)

Resend powers transactional email (password reset, future notifications).
Full operator guide — DNS records, FROM-address conventions, DMARC, escalation
plan — lives in [EMAIL_SETUP.md](./EMAIL_SETUP.md). This section covers only
the env-var side.

### Local development

Leave `RESEND_API_KEY` unset — `isEmailConfigured()` returns false and the
password-reset send-site logs the reset URL to console instead of trying to
deliver. No Resend account needed for local work.

To exercise the real send path locally, set in `.env.local`:

```bash
RESEND_API_KEY=re_xxx
NEXT_PUBLIC_APP_ENV=staging   # so subjects get the [Staging] prefix
```

Get a key from [resend.com/api-keys](https://resend.com/api-keys). Sends are
billed against the shared account; staging-tier delivery only — never test
with `NEXT_PUBLIC_APP_ENV=production` from a dev machine.

### `RESEND_TEST_API_KEY` — the E2E runner's read key

Separate from `RESEND_API_KEY`, and never read by the app. The Playwright
forgot-password spec (HON-479) needs to open the reset email the app just sent,
which on preview and staging is only possible through Resend's read endpoints
(`GET /emails`, `GET /emails/{id}`).

- **Scope:** read access to the same Resend team the app sends from. A
  send-only key will not work; a full-access key works but is more than needed.
- **Where it goes:** GitHub Actions secrets, consumed by the preview-smoke and
  staging-smoke workflows. It is a _test-runner_ variable — do **not** add it to
  Vercel.
- **When it is unset:** tier 1 CI and `pnpm test:e2e:local` fall back to the
  test-only `/api/e2e-support` back-channel and still run the full flow; the
  remote tiers skip the spec rather than failing, so the promotion gate stays
  meaningful. Provisioning the key is what enables it there.

Details and the backend-selection logic: `tests/e2e/README.md` §
"Reading email in specs".

### FROM addresses

Code constants in [`src/lib/resend.ts`](../src/lib/resend.ts) → `EMAIL_SENDERS`.
Not env-configurable; see [EMAIL_SETUP.md](./EMAIL_SETUP.md) for the rationale.

## Upstash Redis (rate limiting)

Upstash Redis backs the rate limiter introduced in HON-451. It gates all AI endpoints (`/api/meal-plans/generate`, `/api/meals/imagine`, `/api/recipes/parse`, meal-plan preparation tips + suggestions) plus the three abuse-sensitive auth POSTs (`/sign-up/email`, `/sign-in/email`, `/request-password-reset`) via `RATE_LIMITED_PATHS` in [`src/app/api/auth/[...all]/route.ts`](../src/app/api/auth/[...all]/route.ts). Both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` must be set.

**When Redis is unreachable, `checkRateLimit` fails open**: the request is allowed through _uncounted_, flagged `degraded: true`, and reported to PostHog. Rate limiting is abuse protection, not an authentication dependency — previously an Upstash failure threw out of every caller as a bare 500, taking down sign-in, sign-up, password reset, all the AI routes, and data export. That happened on **production and staging** for ~2.5 months without anyone noticing, because `/api/status` only probed Postgres.

The cause was not a rotated token: the Vercel-native **Free** store was archived by Upstash for inactivity after a Jun 11 → Aug 27 gap with zero traffic, and every request then failed with `getaddrinfo ENOTFOUND <store>.upstash.io`. Hence the plan recommendation below.

So a broken Upstash config no longer breaks the product — it silently removes abuse protection. Watch for it via the `rateLimit` component on `/status` (and `rateLimit` in `/api/status`), which probes Redis directly with a `PING`.

### Local dev

1. Create a free DB at [console.upstash.com/redis](https://console.upstash.com/redis) (Global region is fine; free tier covers 500k commands/month).
2. On the DB's **Details** page → **Connect → REST** tab, reveal and copy the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` lines.
3. Paste into `.env` (this repo uses a single `.env` locally, not `.env.local`).

### Vercel (deployed environments)

1. Install the [Upstash Redis integration](https://vercel.com/marketplace/upstash) on the `honkadori` project. Recommended settings:
   - **Create New Upstash Account (Vercel Native)** for simpler billing.
   - **Plan: pay-as-you-go, not Free.** Upstash **archives Free stores after a period of inactivity**, which is exactly how rate limiting silently died across production and staging for ~2.5 months. A low-traffic project is the worst case for a Free store: long quiet stretches are normal, so the store gets archived and every rate-limit-gated request starts failing DNS resolution. Pay-as-you-go stores are not archived and cost effectively nothing at this volume.
   - **Eviction: ON** — keys have TTLs, so eviction never drops anything load-bearing; it just keeps the endpoint healthy if the DB fills up.
   - Environments: Dev / Preview / Production.
   - Custom Prefix: `UPSTASH`.
2. **Gotcha — env var naming.** The integration never injects `UPSTASH_REDIS_REST_*`, which is what the app's env schema reads, so it does not wire up automatically no matter what you do. With the `UPSTASH` custom prefix above it injects `UPSTASH_KV_REST_API_URL`, `UPSTASH_KV_REST_API_TOKEN`, `UPSTASH_KV_URL`, `UPSTASH_REDIS_URL`, and a read-only token. (Without a prefix you get the legacy unprefixed `KV_*` / `REDIS_URL` names instead — the prefix exists to keep them recognisable.) Copy the REST URL and token into the two vars in step 3 by hand.
3. In **Project Settings → Environment Variables**, manually add two vars using the values from the Upstash console's **Details → Connect → REST** tab:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

   Scope both to **all** environments — Dev, Preview, Production, and any custom environments (e.g. `staging`). Vercel Marketplace integrations cannot target custom environments (the `...` menu on integration-managed vars only offers Manage / Copy / Remove), so these manual entries are the only way staging gets values.

4. Leave the auto-injected `UPSTASH_KV_*` / `UPSTASH_REDIS_URL` vars in place — they're integration-managed, read-only, and harmless. Do delete leftovers from a previous store (unprefixed `KV_*`, `REDIS_URL`): nothing reads them, and they make it ambiguous which store is live.

### Token rotation

**The most likely cause of a `rateLimit: down` on `/status` is an archived store** — see the plan note above; a Free store goes away after enough quiet, and the symptom is `getaddrinfo ENOTFOUND <store>.upstash.io` on every rate-limit-gated request.

Second most likely is a stale token: because the two `UPSTASH_REDIS_REST_*` vars are entered manually, Upstash-side rotation doesn't propagate. If you rotate, re-copy from the REST tab into each env scope.

Either way, the limiter now fails open, so nothing user-facing breaks — `/status` is the only signal you get.

### Verify after provisioning

- `/api/status` → `components.rateLimit.status` is `ok` (and `overall` is not `degraded`).
- Preview deploy: `/api/meal-plans/generate` returns 200, not 500.
- Upstash Data Browser shows keys like `ratelimit:household:plan-generation:{id}` after an AI call.
- Trigger 6 generations within an hour from the same household → the 6th returns 429 with a `Retry-After` header. If it doesn't, the limiter is failing open — check `rateLimit` on `/status`.

## PostHog (analytics, errors, source maps)

PostHog is the consolidated home for product analytics, error tracking, web analytics + CWV, feature flags, and (later) session replay. Installed by HON-474 as the foundation that child issues (HON-452, HON-460, HON-475, HON-476, HON-477, HON-478) build on.

### Project topology

Three PostHog projects match Vercel's three environments:

| Vercel env    | PostHog project        | `NEXT_PUBLIC_POSTHOG_KEY` | `POSTHOG_CLI_PROJECT_ID` |
| ------------- | ---------------------- | ------------------------- | ------------------------ |
| Production    | `mealplan-production`  | prod token                | prod numeric id          |
| Staging       | `mealplan-staging`     | staging token             | staging numeric id       |
| Preview + Dev | `mealplan-development` | dev token                 | dev numeric id           |

All three projects live in the `Honkadori` PostHog organisation on EU Cloud.

### Env vars

Five variables total — three are per-env (distinct values), two are identical across envs.

| Variable                   | Scope      | Purpose                                                                                           |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_POSTHOG_KEY`  | runtime    | Project token for `posthog-js` + `posthog-node`. **Per-Vercel-env.** Unset = PostHog disabled.    |
| `NEXT_PUBLIC_POSTHOG_HOST` | runtime    | Ingest host — `https://eu.i.posthog.com`. Identical across all envs.                              |
| `POSTHOG_CLI_HOST`         | build-time | Admin host for `posthog-cli` — `https://eu.posthog.com`. Identical across all envs.               |
| `POSTHOG_CLI_PROJECT_ID`   | build-time | Numeric project id for sourcemap upload. **Per-Vercel-env.**                                      |
| `POSTHOG_CLI_API_KEY`      | build-time | Personal API key with `sourcemap:write` scope. Identical across all envs (one key for all three). |

**Admin host ≠ ingest host.** `POSTHOG_CLI_HOST` is `https://eu.posthog.com` (app surface). Event ingestion uses `https://eu.i.posthog.com`. Swapping produces auth errors that read like "invalid project ID".

**Project token ≠ personal API key.** `posthog-node` and `posthog-js` both use the **project token** (`NEXT_PUBLIC_POSTHOG_KEY`). The personal API key (`POSTHOG_CLI_API_KEY`) is for the CLI only. They are different values with different scopes.

### Local dev

In `.env`, set `NEXT_PUBLIC_POSTHOG_KEY` + `NEXT_PUBLIC_POSTHOG_HOST` to the `mealplan-development` project values (or leave both unset to disable PostHog locally — tests and dev still work without it). Leave the `POSTHOG_CLI_*` vars unset; local `pnpm build` skips the sourcemap upload because the postbuild script gates on `VERCEL_GIT_COMMIT_SHA`.

### Vercel

In **Project Settings → Environment Variables**, set the five variables per the scope column above. The `mealplan-development` token covers both **Preview** and **Development** targets in Vercel; `mealplan-staging` targets the custom `staging` environment; `mealplan-production` targets **Production**.

### Verify after provisioning

- Fresh incognito → accept cookie consent → `$pageview` appears in the matching PostHog project, tagged with an authenticated `user_id`.
- Decline cookie consent → no `ph_*` cookies, no PostHog network requests.
- After a Vercel preview build, the CLI sourcemap upload step output reports a non-zero `.map` count (visible in the Vercel build log under `postbuild`).

## Neon Database Branching (optional)

When `NEON_API_KEY` and `NEON_PROJECT_ID` are set, `wt new` / `wt auto` provision a per-worktree [Neon branch](https://neon.com/guides/git-worktrees-neon-branching) — an isolated copy-on-write copy of the database forked from a parent branch (default `staging`). Each worktree gets its own `DATABASE_URL`, so `pnpm db:migrate` in one worktree does not clobber the schema in another. `wt cleanup` removes the paired Neon branch automatically.

Leaving the vars blank is the opt-out — worktrees print a one-line warning and fall back to the shared `DATABASE_URL`.

### Setup

1. **API key.** Go to [console.neon.tech/app/settings/api-keys](https://console.neon.tech/app/settings/api-keys), create a personal key, copy the `neon_...` value into `NEON_API_KEY`.
2. **Project ID.** Open your Neon project. The project ID appears in the URL (`console.neon.tech/app/projects/<project-id>/...`) and under **Settings → General → Project ID**. Copy it into `NEON_PROJECT_ID`.
3. **Parent branch (optional).** Defaults to `staging`. Override with `NEON_PARENT_BRANCH=some-other-branch` if you need a different schema base.
4. **User prefix (optional).** Set `NEON_USER_PREFIX` to the first path component of your interactive branches (e.g. `kaupo` if you run `wt new kaupo/feature-x`). Orphan GC will then auto-reclaim your stale branches alongside orchestrator-spawned `auto-*` ones. Leave blank to only auto-reclaim `auto-*` branches.
5. **(Recommended)** In the Neon dashboard, mark `staging` (and `production` if it exists) as **protected** (⛨). This adds a server-side delete guardrail on top of the script's blocklist.

### How it works

- Branch name mapping is deterministic: `auto/hon-339-foo` → Neon branch `auto--hon-339-foo` (slashes become double-dashes so `feat/foo-bar` and `feat-foo/bar` don't collide).
- `neonctl` runs via `pnpm dlx` with a pinned version — no install step required.
- A failed `neonctl branches create` is classified from its error text alone, with the branch name stripped out first — `already exists` / `duplicate` is checked before the cap keywords, because the former is an unambiguous API signal and the latter is a guess at undocumented wording (HON-581).
- A branch that already exists is reused when the git branch is being resumed (an orchestrator RETRY or force-kill recovery), and is a hard stop otherwise. Pass `--fresh-db` to `wt new` / `wt auto` to force delete-and-recreate — that flag never falls back to reuse, since a branch surviving its pre-delete means the delete did not take.
- Only a genuine cap error triggers the automatic GC pass, which deletes branches whose git worktree no longer exists and then retries once. "Genuine" means `branch` and an exhaustion keyword on the same line: the GC is project-wide, so an unrelated rate-limit response must not reach it.

### Inspecting branches

```bash
# List Neon branches
pnpm dlx neonctl@2.22.0 branches list --project-id "$NEON_PROJECT_ID"

# Get the connection string for a specific branch
pnpm dlx neonctl@2.22.0 connection-string <branch-name> --project-id "$NEON_PROJECT_ID" --pooled
```

## Cron secret (account-deletion purge)

`CRON_SECRET` authenticates the daily GDPR purge cron (`/api/cron/purge-deleted-users`, HON-481), which hard-deletes accounts whose 30-day grace window has elapsed.

### How it works

- The route requires `Authorization: Bearer <CRON_SECRET>` and returns **401** on any mismatch or missing header.
- [Vercel Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs) **auto-injects** this header on scheduled invocations whenever a `CRON_SECRET` env var exists on the project — no per-cron config needed. The schedule lives in `vercel.json` (`0 3 * * *`, 03:00 UTC).
- Validation is `z.string().min(32).optional()`. It is **optional** so local/dev and CI can boot without it (the cron is simply unreachable). In **production** the route returns **500** if it is unset, so a misconfigured deploy fails loud rather than silently never purging.

### Local dev

Leave unset — the purge cron is not scheduled locally. To exercise the route manually, set any 32+ char value and pass it as a Bearer token:

```bash
CRON_SECRET=$(openssl rand -base64 32)
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/purge-deleted-users
```

### Vercel (deployed environments)

Add `CRON_SECRET` (≥32 chars, e.g. `openssl rand -base64 32`) to **Project Settings → Environment Variables** for Production (and Preview/Staging if you want the cron there). Vercel handles the header automatically once it is set.

## Admin email

`ADMIN_EMAIL` is the one account allowed into `/admin/signup-codes` and its API routes (HON-488). `isAdmin(session)` in `src/lib/auth-helpers.ts` compares the signed-in user's email against it, case-insensitively. Nothing else reads it, so the app boots without it; the admin route throws a validation error instead of returning 404 if it is unset.

It is deliberately a single email rather than a role: the invite-only beta has one operator. Switch to a role-based check before opening admin access to anyone else.

## Application URL

`NEXT_PUBLIC_APP_URL` is an override, not a requirement. `getClientBaseURL()` and `getServerBaseURL()` in `src/lib/env.ts` resolve the base URL in this order:

1. `NEXT_PUBLIC_APP_URL`, if set
2. `NEXT_PUBLIC_VERCEL_URL` / `VERCEL_URL`, which Vercel sets on every deployment
3. `http://localhost:3000`

Better Auth derives its `baseURL` and `trustedOrigins` from the result, which is why the local E2E runner sets it explicitly to the port it starts the app on. Set it in Vercel only when the deployment URL is not the one users should see, such as a custom domain in front of a preview.

## Diagnostics and test-only switches

Three switches exist for operators and test runners. None should be set in a normal deployment.

- **`STATUS_INCIDENT_MESSAGE`** — free-text banner rendered on `/status` while an incident is in progress. Setting or removing it is a deploy. When to use it and the exact `vercel env` commands are in [docs/RUNBOOKS/status-page.md](./RUNBOOKS/status-page.md).
- **`E2E_DISABLE_RATE_LIMIT`** — `1` or `true` bypasses the abuse-sensitive rate limiter so CI sign-up tests do not collide on the shared runner IP. `src/lib/rate-limit.ts` only honours it when `NEXT_PUBLIC_APP_ENV` is `ci`, `test`, or `dev`; any other environment throws at module init, so a stray value cannot disable rate limiting in production (HON-521).
- **`SIGNUP_TIMING_LOG`** — `1` or `true` logs per-step sign-up timings (breached-password check, password hashing, invite-code lookup, total) to stderr. Off by default so production sign-ups stay quiet; `scripts/e2e-local.sh` turns it on to diagnose slow local runs (HON-569).

## Validation

All environment variables are validated at startup with clear error messages if validation fails.

**Validation features:**

- Required vs optional variables
- Type checking (string, number, URL, etc.)
- Format validation (email, URL patterns, etc.)
- Clear error messages pointing to the specific variable

**Note:** `NODE_ENV` is managed by Next.js and should be accessed directly from `process.env.NODE_ENV`.

## Drift audit (`pnpm env:audit`)

Vercel's dashboard has no review trigger, so a variable removed from the code can
linger there as dead config indefinitely. `pnpm env:audit` is a read-only check that
takes every variable configured in Vercel and asks whether this repo still references
it anywhere — `process.env` reads, shell `$VAR`, workflow `secrets.*`, `.env.example`.

It reports two tiers:

| Tier         | Meaning                                                                   |
| ------------ | ------------------------------------------------------------------------- |
| **ORPHAN**   | The name appears nowhere in the repo. Almost certainly dead config.       |
| **DOC-ONLY** | The name appears only in Markdown / `.env*` — a half-finished retirement. |

Names written by Vercel Marketplace integrations (`UPSTASH_KV_*`, `UPSTASH_REDIS_URL`)
are skipped via an ignore list in `scripts/env-audit.ts` — we neither read nor own them.

The audit never deletes anything. Removing a confirmed orphan stays a manual step in
**Vercel → Settings → Environment Variables**, in every environment it is set in.

### Local use

Requires a linked project (`vercel link` once — it writes the gitignored `.vercel/repo.json`):

```bash
pnpm env:audit            # warn-only, always exits 0
pnpm env:audit --strict   # exits 1 when ORPHANs are found
```

### CI use

The `Vercel env-var drift audit` job in `.github/workflows/ci.yml` runs it on every PR,
blocking. The job calls `pnpm env:audit --strict`, so an ORPHAN finding fails the job. It
carries no `continue-on-error`, so a script crash fails the job too — a green check proves
the audit ran and found no drift. `.vercel/` is gitignored and absent in CI, so project
identity must come from repository secrets — never from a checked-in project file:

| Secret              | Where to get it                                  |
| ------------------- | ------------------------------------------------ |
| `VERCEL_TOKEN`      | Vercel → Account Settings → Tokens               |
| `VERCEL_PROJECT_ID` | Vercel → Project Settings → General → Project ID |
| `VERCEL_ORG_ID`     | Vercel → Team Settings → General → Team ID       |

All three are required — this project is team-scoped, so a REST call without `teamId`
returns 403. If any is unset the job logs a warning and exits 0, so forked PRs (which
receive no secrets) stay green. Findings are also emitted as GitHub warning annotations
and a step summary for at-a-glance triage; an ORPHAN finding fails the job.

DOC-ONLY findings stay non-blocking: `scripts/env-audit.ts` sets a non-zero exit code for
ORPHAN findings only, so a doc drift reports without blocking the PR.

## Usage in Code

For usage patterns and examples, see the "Environment Variables" section in CLAUDE.md.

Quick reference:

```typescript
// Client-side (Client Components, browser code)
import { clientEnv } from '@/lib/env'
console.log(clientEnv.NEXT_PUBLIC_APP_NAME)

// Server-side (Server Components, API routes)
import { serverEnv } from '@/lib/env'
console.log(serverEnv.BETTER_AUTH_SECRET)
console.log(serverEnv.DATABASE_URL)
```

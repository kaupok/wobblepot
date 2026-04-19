# Environment Variables Setup Guide

Complete guide for setting up and managing environment variables in the Honkadori project.

## Table of Contents

- [Overview](#overview)
- [Initial Setup](#initial-setup)
- [Special Characters in Values](#special-characters-in-values)
- [Adding New Environment Variables](#adding-new-environment-variables)
  - [Adding a Public Variable](#adding-a-public-variable-next_public_)
  - [Adding a Server-Only Variable](#adding-a-server-only-variable)
- [Validation](#validation)

## Overview

Environment variables are validated at runtime using Zod. This ensures all required configuration is present and correctly formatted before the app starts.

**Important:** We use separate validation for client and server environments to prevent accidentally exposing server-only secrets to the client bundle.

## Initial Setup

1. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. Fill in required values in `.env` (never commit this file - already in .gitignore)

3. Environment validation happens automatically on app startup in `src/lib/env.ts`

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

Resend is used for transactional emails (password reset, etc.).

### Setup

1. Create an account at [resend.com](https://resend.com)
2. Get your API key from [resend.com/api-keys](https://resend.com/api-keys)
3. Add to `.env`:
   ```bash
   RESEND_API_KEY=re_xxx
   RESEND_FROM_EMAIL=onboarding@resend.dev
   ```

### Development vs Production

**Development:**

- Use `onboarding@resend.dev` as the from email (Resend's test address)
- Emails can only be sent to the account owner's email
- No domain verification required

**Production:**

- Verify your domain in Resend dashboard
- Use a verified email like `noreply@yourdomain.com`
- Full email delivery to any recipient

### Domain Verification

For production use:

1. Go to [resend.com/domains](https://resend.com/domains)
2. Add your domain
3. Add the required DNS records (MX, TXT for SPF/DKIM)
4. Wait for verification (usually < 24 hours)
5. Update `RESEND_FROM_EMAIL` to use your domain

### Testing

- Check [resend.com/emails](https://resend.com/emails) for sent email logs
- Development emails only reach the account owner
- Use Resend's email preview to test templates

## Upstash Redis (rate limiting)

Upstash Redis backs the rate limiter introduced in HON-451. All AI endpoints (`/api/meal-plans/generate`, `/api/meals/imagine`, `/api/recipes/parse`, meal-plan preparation tips + suggestions) require `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; missing values cause a 500 on the first rate-limit-gated request.

### Local dev

1. Create a free DB at [console.upstash.com/redis](https://console.upstash.com/redis) (Global region is fine; free tier covers 500k commands/month).
2. On the DB's **Details** page → **Connect → REST** tab, reveal and copy the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` lines.
3. Paste into `.env` (this repo uses a single `.env` locally, not `.env.local`).

### Vercel (deployed environments)

1. Install the [Upstash Redis integration](https://vercel.com/marketplace/upstash) on the `honkadori` project. Recommended settings:
   - **Create New Upstash Account (Vercel Native)** for simpler billing.
   - **Eviction: ON** — keys have TTLs, so eviction never drops anything load-bearing; it just keeps the endpoint healthy if the DB fills up.
   - Environments: Dev / Preview / Production.
   - Custom Prefix: leave blank.
2. **Gotcha — env var naming.** The integration injects values under Vercel's legacy KV names (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_URL`, etc.), not `UPSTASH_REDIS_REST_*`. The app's env schema expects the `UPSTASH_REDIS_REST_*` names, so these don't wire up automatically.
3. In **Project Settings → Environment Variables**, manually add two vars using the values from the Upstash console's **Details → Connect → REST** tab:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

   Scope both to **all** environments — Dev, Preview, Production, and any custom environments (e.g. `staging`). Vercel Marketplace integrations cannot target custom environments (the `...` menu on integration-managed vars only offers Manage / Copy / Remove), so these manual entries are the only way staging gets values.

4. Leave the auto-injected `KV_*` vars in place — they're integration-managed, read-only, and harmless.

### Token rotation

Since the two `UPSTASH_REDIS_REST_*` vars are entered manually, Upstash-side token rotation won't propagate automatically. If you rotate, re-copy from the REST tab into each env scope. Low-risk for rate limiting.

### Verify after provisioning

- Preview deploy: `/api/meal-plans/generate` returns 200, not 500.
- Upstash Data Browser shows keys like `ratelimit:household:plan-generation:{id}` after an AI call.
- Trigger 6 generations within an hour from the same household → the 6th returns 429 with a `Retry-After` header.

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
- When the project hits the branch cap (10 on the free tier), `wt` runs an automatic GC pass to delete branches whose git worktree no longer exists, then retries once.
- If a Neon branch with the target name already exists after GC, `wt` fails loud. Pass `--fresh-db` to `wt new` / `wt auto` to force delete-and-recreate.

### Inspecting branches

```bash
# List Neon branches
pnpm dlx neonctl@2.22.0 branches list --project-id "$NEON_PROJECT_ID"

# Get the connection string for a specific branch
pnpm dlx neonctl@2.22.0 connection-string <branch-name> --project-id "$NEON_PROJECT_ID" --pooled
```

## Validation

All environment variables are validated at startup with clear error messages if validation fails.

**Validation features:**

- Required vs optional variables
- Type checking (string, number, URL, etc.)
- Format validation (email, URL patterns, etc.)
- Clear error messages pointing to the specific variable

**Note:** `NODE_ENV` is managed by Next.js and should be accessed directly from `process.env.NODE_ENV`.

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

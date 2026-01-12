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

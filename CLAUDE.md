# Honkadori - Code Guidelines

## Table of Contents

- [Project Overview](#project-overview)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [File Organization](#file-organization)
- [Authentication Patterns](#authentication-patterns)
- [Data Fetching Patterns](#data-fetching-patterns)
- [Error Handling Strategy](#error-handling-strategy)
- [Form Handling Patterns](#form-handling-patterns)
- [Code Standards](#code-standards)
  - [Typography Components](#typography-components)
- [Environment Variables](#environment-variables)
- [Database Patterns](#database-patterns)
- [Testing](#testing)
- [Review Focus](#review-focus)
- [CI Pipeline](#ci-pipeline)
- [Production Deployment Process](#production-deployment-process)
- [Commit Message Conventions](#commit-message-conventions)

## Project Overview

A Next.js 15 project with React 19, using TypeScript, Tailwind CSS, and shadcn/ui components.

## Tech Stack

- **Framework**: Next.js 15.5.3 with Turbopack
- **Language**: TypeScript 5.9
- **Styling**: Tailwind CSS 4.1 with class-variance-authority
- **Testing**: Vitest for unit tests, Playwright for E2E
- **Linting**: ESLint 9 + Prettier
- **Package Manager**: pnpm 10.9
- **Database**: PostgreSQL (Neon) with Prisma ORM
- **Authentication**: Better Auth

## Architecture Overview

### Directory Structure

- **/app**: Next.js App Router (routes, layouts, error boundaries)
- **/components**: Reusable UI components
  - `/ui`: shadcn/ui primitives (button, card, typography, input, label, etc.)
  - Root level: Feature components (header, theme-toggle, etc.)
- **/lib**: Shared utilities, configuration, and service clients
  - `auth.ts`: Server-side Better Auth instance
  - `auth-client.ts`: Client-side Better Auth instance
  - `env.ts`: Environment variable validation (Zod schemas)
  - `prisma.ts`: Prisma client singleton
  - `utils.ts`: Utility functions (cn, etc.)
- **/hooks**: Custom React hooks (useThemeColor, etc.)
- **/e2e**: Playwright E2E tests
- **/prisma**: Database schema and migrations

### Key Architectural Patterns

- **Server Components by default**: All page.tsx files are async Server Components unless they need interactivity
- **"use client" only when necessary**: Add the directive only for components that need:
  - Interactivity (onClick, onChange, etc.)
  - Browser APIs (localStorage, window, etc.)
  - React hooks (useState, useEffect, etc.)
- **Colocated tests**: Tests live next to their source files with `.test.tsx` or `.test.ts` suffix
- **Absolute imports**: Use `@/` prefix for all imports (configured via tsconfig paths)
- **Type-safe environment variables**: All env vars validated with Zod at startup (see `lib/env.ts:3`)

## File Organization

### Naming Conventions

- **Components**: PascalCase (`UserProfile.tsx`, `Header.tsx`, `ThemeToggle.tsx`)
- **Utilities**: camelCase (`formatDate.ts`, `utils.ts`)
- **Hooks**: camelCase with "use" prefix (`useAuth.ts`, `useThemeColor.ts`)
- **Tests**: Same name as source + `.test.ts(x)` suffix (`button.test.tsx`, `utils.test.ts`)

### Where to Put New Code

- **shadcn UI primitives** → `/components/ui` (generated via CLI, minimal customization)
- **Feature components** → `/components` root level (components used across multiple routes)
- **Route-specific components** → Colocate in `/app/[route]/` directory
- **Shared hooks** → `/hooks`
- **Utilities & config** → `/lib`
- **API routes** → `/app/api/[route]/route.ts`
- **Page routes** → `/app/[route-name]/page.tsx`

## Authentication Patterns

We use **Better Auth** for authentication with email/password (no OAuth yet).

### Setup

- **Server instance**: `lib/auth.ts:16` - Use in Server Components and API routes
- **Client instance**: `lib/auth-client.ts:4` - Use in Client Components
- **API route**: `/api/auth/[...all]` - Handles all auth endpoints (sign-in, sign-up, sign-out, session)

### Protecting Routes (Server Components)

```tsx
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function ProtectedPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect('/sign-in')
  }

  // Render protected content
  return <div>Hello {session.user.name}</div>
}
```

**See example**: `src/app/profile/page.tsx:8-15`

### Client-Side Authentication Forms

```tsx
'use client'

import { authClient } from '@/lib/auth-client'
import { useRouter } from 'next/navigation'

const router = useRouter()

await authClient.signIn.email(
  { email, password },
  {
    onSuccess: () => {
      router.push('/profile')
      router.refresh() // Refresh Server Components with new session
    },
    onError: (ctx) => {
      setError(ctx.error.message)
    },
  },
)
```

**See example**: `src/app/sign-in/page.tsx:59-74`

### Reading Session in Server Components

```tsx
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

// Always pass headers for proper session management
const session = await auth.api.getSession({
  headers: await headers(),
})

// session is null if not authenticated
if (session) {
  console.log(session.user.name, session.user.email)
}
```

**See example**: `src/app/page.tsx:8-11`

### Sign Out Pattern

Create a Client Component for sign-out action:

```tsx
'use client'

import { authClient } from '@/lib/auth-client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export function SignOutButton() {
  const router = useRouter()

  const handleSignOut = async () => {
    await authClient.signOut()
    router.push('/')
    router.refresh()
  }

  return <Button onClick={handleSignOut}>Sign Out</Button>
}
```

## Data Fetching Patterns

### Server Components (Preferred)

Fetch data directly in async Server Components:

```tsx
export default async function Page() {
  // Direct async data fetching
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  const data = await prisma.user.findUnique({
    where: { id: session.user.id },
  })

  // No loading states needed - Next.js handles streaming
  // Automatic request deduplication within a single render

  return <div>{data.name}</div>
}
```

**Benefits:**

- No client-side loading states
- Better performance (data fetched on server)
- SEO-friendly
- Automatic request deduplication

**See examples**: `src/app/page.tsx:8-11`, `src/app/profile/page.tsx:8-15`

### Client Components

Use native React state management for client-side data fetching:

```tsx
'use client'

import { useState } from 'react'

export default function ClientForm() {
  const [data, setData] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setIsLoading(true)
    setError('')

    try {
      const result = await authClient.signIn.email(...)
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (/* form with loading/error states */)
}
```

**See example**: `src/app/sign-in/page.tsx:46-78`

**Note**: We currently use native patterns (no SWR/React Query). For mutations, use Better Auth client methods or native fetch.

## Error Handling Strategy

### Route-Level Error Boundaries

Next.js provides automatic error boundaries via `error.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Heading, Body, Pre } from '@/components/ui/typography'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to error reporting service (Sentry, LogRocket, etc.)
    console.error('Route error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <div className="max-w-md text-center">
        <div className="flex flex-col gap-3">
          <Heading variant="h2">Oops! Something went wrong</Heading>
          <Body>We encountered an error while loading this page.</Body>
          {error.digest && <Body variant="muted">Error ID: {error.digest}</Body>}
        </div>
        {process.env.NODE_ENV === 'development' && (
          <details className="mt-4 mb-4 text-left">
            <summary className="cursor-pointer font-semibold">Error details</summary>
            <Pre className="text-destructive text-xs">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </Pre>
          </details>
        )}
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  )
}
```

**See example**: `src/app/error.tsx`

### User-Friendly Error Messages

Map technical errors to user-friendly messages:

```tsx
function getUserFriendlyError(message: string): string {
  const lowerMessage = message.toLowerCase()

  if (lowerMessage.includes('invalid') && lowerMessage.includes('credentials')) {
    return 'The email or password you entered is incorrect. Please try again.'
  }
  if (lowerMessage.includes('user not found')) {
    return 'No account found with this email address.'
  }
  if (lowerMessage.includes('too many')) {
    return 'Too many sign-in attempts. Please try again later.'
  }
  if (lowerMessage.includes('network') || lowerMessage.includes('fetch')) {
    return 'Unable to connect to the server. Please check your internet connection.'
  }

  // Return the original message if no mapping found
  return message
}

// Usage in forms
onError: (ctx) => {
  setError(getUserFriendlyError(ctx.error.message))
}
```

**See example**: `src/app/sign-in/page.tsx:23-44`

### Development vs Production Errors

Show detailed errors only in development mode:

```tsx
{
  process.env.NODE_ENV === 'development' && (
    <details>
      <summary>Error details</summary>
      <Pre className="text-destructive text-xs">
        {error.message}
        {error.stack}
      </Pre>
    </details>
  )
}
```

**See example**: `src/app/error.tsx:28-36`

## Form Handling Patterns

We use native HTML forms with controlled inputs (no form library currently).

### Standard Form Pattern

```tsx
'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'

export default function MyForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      // Submit logic
      await authClient.signIn.email(
        { email, password },
        {
          onSuccess: () => {
            // Handle success
          },
          onError: (ctx) => {
            setError(getUserFriendlyError(ctx.error.message))
          },
        },
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isLoading}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
            minLength={8}
          />
        </div>
        {error && (
          <Body variant="small" className="text-destructive">
            {error}
          </Body>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? 'Submitting...' : 'Submit'}
      </Button>
    </form>
  )
}
```

**See example**: `src/app/sign-in/page.tsx:46-141`

### Form Validation

- **HTML5 validation**: Use `required`, `type="email"`, `minLength`, `maxLength`, etc.
- **Custom validation**: Validate in submit handler before API call
- **Server-side validation**: Better Auth handles password requirements (min 8 characters by default)
- **Disable during submission**: Set `disabled={isLoading}` on all inputs and buttons

## Code Standards

### TypeScript & Linting

- Strict TypeScript mode (`tsconfig.json`)
- ESLint rules enforced by CI
- Prettier formatting (run `pnpm format` before committing)
- Use `pnpm lint` to check for issues

### Styling

- Tailwind CSS for styling
- shadcn/ui components for reusable components
- Use `tailwind-merge` for dynamic class merging
- Avoid inline styles; use Tailwind utilities

### Components & Hooks

- Functional components only (no class components)
- Use React hooks for state management
- Keep components focused and single-responsibility
- Use TypeScript types for props

### Typography Components

We use two main variant-based components for typography:

#### `Heading` Component

Renders semantic heading elements (h1-h4) with consistent styling:

```tsx
<Heading>Default (h1)</Heading>
<Heading variant="h2">Secondary heading</Heading>
<Heading variant="h3">Tertiary heading</Heading>
<Heading variant="h4">Quaternary heading</Heading>
```

**Available variants:** `h1` | `h2` | `h3` | `h4`

#### `Body` Component

Renders paragraph text with different text sizes and styles:

```tsx
<Body>Default body text</Body>
<Body variant="lead">Lead/intro text (larger, muted)</Body>
<Body variant="large">Large text (lg, semibold)</Body>
<Body variant="small">Small text (sm, medium weight)</Body>
<Body variant="muted">Muted text (sm, muted color)</Body>
```

**Available variants:** `default` | `lead` | `large` | `small` | `muted`

#### Separation of Concerns

**Text styling only** (in components):

- Font size, weight, color, line-height, tracking
- Components handle all text presentation concerns

**Layout concerns** (via wrapper elements):

- Margins, padding, display, positioning
- Apply layout classes to a wrapper `<div>` instead of directly on typography components

**Exceptions** - Built-in layout when essential:

- `Blockquote`: includes `pl-6` (padding needed for the border design to work correctly)
- `Ul`/`Ol`: include `my-6 ml-6` (vertical/horizontal spacing is intrinsic to list formatting; ml-6 for indentation, my-6 to match typographic rhythm of other block elements)
- `Pre`: includes `p-4` (padding needed for code block presentation and readability)

**Practical Guidelines:**

1. **When wrapping would create invalid HTML** (e.g., block elements in inline contexts):
   - Apply minimal spacing directly to the typography component
   - Example: `<Heading className="mb-4">Title</Heading>`

2. **When grouping related typography elements:**
   - Use a flex container with `gap` when all elements need uniform spacing
   - Use nested containers with individual spacing when different relationships need different gaps
   - Example with uniform spacing:

   ```tsx
   <div className="flex flex-col gap-3">
     <Heading variant="h2">Main heading</Heading>
     <Body>Primary description</Body>
   </div>
   ```

   - Example with varied spacing:

   ```tsx
   <div className="flex flex-col gap-6">
     <Heading variant="h2">Main heading</Heading>
     <div className="flex flex-col gap-2">
       <Body>Primary description</Body>
       <Body variant="small">Secondary note</Body>
     </div>
   </div>
   ```

**Example - DON'T:**

```tsx
<Body variant="muted" className="mb-6 block">
  Error ID: 12345
</Body>
```

#### Other Components

**`Blockquote`** - Semantic blockquote with left border and padding:

```tsx
<Blockquote>"This is a great quote that I found somewhere online."</Blockquote>
```

**`Ul`/`Ol`/`Li`** - Semantic lists with built-in spacing:

```tsx
<Ul>
  <Li>First item</Li>
  <Li>Second item</Li>
  <Li>Third item</Li>
</Ul>

<Ol>
  <Li>First step</Li>
  <Li>Second step</Li>
  <Li>Third step</Li>
</Ol>
```

**`Code`** - Inline code with styling:

```tsx
<Body>
  Use the <Code>npm install</Code> command to install dependencies.
</Body>
```

**`Pre`** - Code blocks with scrolling and padding:

```tsx
<div className="my-4">
  <Pre>
    {`function example() {
  return "Hello, world!";
}`}
  </Pre>
</div>
```

#### Custom Classes and Type Styling

All typography components accept a `className` prop that merges with component classes via the `cn()` utility. **However, only pass text-styling classes** (colors, sizes, weights, text-alignment) to maintain separation of concerns:

**DO - text styling classes:**

```tsx
<Pre className="text-destructive text-xs">Error details</Pre>
```

**DON'T - layout classes on component:**

```tsx
<Pre className="mt-2 mb-4">Error details</Pre>
```

**Instead - wrap with layout:**

```tsx
<div className="mt-2 mb-4">
  <Pre className="text-destructive text-xs">Error details</Pre>
</div>
```

## Environment Variables

Environment variables are validated at runtime using Zod. This ensures all required configuration is present and correctly formatted before the app starts.

**Important:** We use separate validation for client and server environments to prevent accidentally exposing server-only secrets to the client bundle.

### Setting Up Environment Variables

1. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. Fill in required values in `.env` (never commit this file - already in .gitignore)

3. Environment validation happens automatically on app startup in `src/lib/env.ts`

### Using Environment Variables in Code

#### Client-Side Code (Browser)

Use `clientEnv` in client components and client-side code. This only includes `NEXT_PUBLIC_*` variables:

```typescript
import { clientEnv } from '@/lib/env'

// Type-safe access to public env vars
console.log(clientEnv.NEXT_PUBLIC_APP_NAME)

// Optional vars are typed as string | undefined
if (clientEnv.NEXT_PUBLIC_APP_URL) {
  console.log(clientEnv.NEXT_PUBLIC_APP_URL)
}
```

#### Server-Side Code (API Routes, Server Components)

Use `serverEnv` in server components, API routes, and server-side code. This includes both `NEXT_PUBLIC_*` and server-only variables:

```typescript
import { serverEnv } from '@/lib/env'

// Access both public and server-only vars
console.log(serverEnv.NEXT_PUBLIC_APP_NAME) // Also available
console.log(serverEnv.BETTER_AUTH_SECRET) // Server-only

// NODE_ENV is managed by Next.js, access it directly from process.env
if (process.env.NODE_ENV === 'development') {
  console.log('Running in development mode')
}
```

**Never import `serverEnv` in client components** - it will throw a helpful error if accessed in the browser.

### Adding New Environment Variables

#### Adding a Public Variable (NEXT*PUBLIC*\*)

1. Add to `clientEnvSchema` in `src/lib/env.ts`:

   ```typescript
   export const clientEnvSchema = z.object({
     // ... existing vars
     NEXT_PUBLIC_MY_VAR: z.string().optional(),
   })
   ```

2. Document in `.env.example`
3. Use via `clientEnv` in your code

#### Adding a Server-Only Variable

1. Add to `serverEnvSchema` in `src/lib/env.ts`:

   ```typescript
   export const serverEnvSchema = clientEnvSchema.extend({
     // ... existing vars
     MY_SERVER_SECRET: z.string(),
   })
   ```

2. Document in `.env.example` (clearly mark as server-only)
3. Use via `serverEnv` in server-side code only

All environment variables are validated at startup with clear error messages if validation fails.

## Database Patterns

We use **Prisma ORM** with **PostgreSQL** (Neon with connection pooling).

### Prisma Client Usage

Import the singleton client instance for server-side database access:

```tsx
import { prisma } from '@/lib/prisma'

// Use in Server Components, API routes, or server-side code only
const users = await prisma.user.findMany({
  where: { emailVerified: true },
  select: { id: true, name: true, email: true },
})

// Relations
const userWithSessions = await prisma.user.findUnique({
  where: { id: userId },
  include: { sessions: true },
})
```

**Never import prisma in client components** - it's server-only and will cause build errors.

**See setup**: `src/lib/prisma.ts`

### Schema Management

- **Location**: `prisma/schema.prisma`
- **Provider**: PostgreSQL with Neon connection pooling
- **Auth models**: Generated by Better Auth CLI, now managed manually in schema

**Current models**: User, Session, Account, Verification (all for Better Auth)

### Migration Workflow

**Development:**

```bash
# Create and apply migration
pnpm db:migrate

# Open Prisma Studio to view/edit data
pnpm db:studio

# Push schema changes without creating migration (for rapid prototyping)
pnpm db:push

# Generate Prisma Client after schema changes
pnpm db:generate
```

**Production:**

```bash
# Apply existing migrations (used in deployment workflow)
pnpm db:migrate:deploy
```

**See deployment process**: Production Deployment Process section below

### Adding New Models

1. Edit `prisma/schema.prisma`:

```prisma
model Post {
  id        String   @id @default(cuid())
  title     String
  content   String
  published Boolean  @default(false)
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("post")
}
```

2. Add relation to existing model if needed:

```prisma
model User {
  // ... existing fields
  posts     Post[]  // Add this line
}
```

3. Create migration:

```bash
pnpm db:migrate
```

4. Commit both schema and migration files
5. Production deployment: Run migrations before code (see Production Deployment Process)

### Database Connection

- **Pooled connection**: `DATABASE_URL` (used by Prisma Client in production)
- **Direct connection**: `DATABASE_URL_UNPOOLED` (used for migrations)
- Both configured in `.env` and validated via `lib/env.ts`

**See schema**: `prisma/schema.prisma:8-14`

## Testing

### Unit/Component Tests (Vitest + Testing Library)

**Test file location**: Colocated with source file using `.test.tsx` or `.test.ts` suffix

**Standard test structure**:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Button } from './button'

describe('Button component', () => {
  it('renders children correctly', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  describe('variants', () => {
    it('applies default variant classes', () => {
      render(<Button>Default</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-primary', 'text-primary-foreground')
    })

    it('applies destructive variant classes', () => {
      render(<Button variant="destructive">Delete</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-destructive', 'text-white')
    })
  })
})
```

**See example**: `src/components/ui/button.test.tsx`

**Running tests**:

```bash
# Run all unit tests
pnpm test

# Run with coverage report
pnpm test:coverage

# Run E2E tests (locally only, disabled in CI)
pnpm test:e2e

# Run all tests
pnpm test:all
```

### What to Test

- **Component rendering**: Verify components render with correct props and children
- **Variants and states**: Test all component variants, sizes, and states
- **User interactions**: Test button clicks, form submissions, input changes
- **Error handling**: Test error states and error messages
- **Utility functions**: Test pure functions with various inputs and edge cases
- **Custom hooks**: Test hook behavior and state changes

### Testing Best Practices

- **Meaningful tests**: Focus on user-facing behavior, not implementation details
- **Accessibility**: Use Testing Library's accessibility queries (`getByRole`, `getByLabelText`)
- **Nested describes**: Group related tests for better organization
- **Clear test names**: Use descriptive names that explain what's being tested
- **Colocate tests**: Keep tests next to source files for easier maintenance

**See examples**: `src/components/ui/button.test.tsx`, `src/components/theme-toggle.test.tsx`, `src/app/page.test.tsx`

## Review Focus

- Flag actual bugs and logic errors
- Suggest improvements only if they have clear value
- Skip nitpicking on formatting (Prettier handles it)
- Ensure tests are meaningful and cover the changes
- Watch for TypeScript strictness violations

## CI Pipeline

All changes must pass the following checks in GitHub Actions:

- `pnpm lint` - ESLint rules
- `pnpm type-check` - TypeScript type checking
- `pnpm test` - Unit tests

**Important notes:**

- Build verification happens through Vercel deployment (not in CI)
- E2E tests are currently disabled in CI but should be run locally before submitting PRs with `pnpm test:e2e`

## Production Deployment Process

Production deployments require manual coordination to ensure database migrations complete before code deployment.

### Deployment Flow

1. **Develop and merge to main**
   - Create PR with your changes
   - Merge to main after approval and CI passes
   - Staging auto-deploys and auto-migrates (via GitHub Actions)

2. **Test in staging**
   - Verify changes work correctly in staging environment
   - Test all affected functionality
   - Check for any migration issues

3. **Deploy to production** (when ready):

   **a. Run database migrations**
   - Go to: [GitHub Actions](https://github.com/kaupok/honkadori/actions/workflows/deploy-db-migrations-production.yml)
   - Click "Run workflow" button
   - Wait for completion and verify success

   **b. Deploy code**
   - Go to: [GitHub Actions](https://github.com/kaupok/honkadori/actions/workflows/deploy-code-production.yml)
   - Click "Run workflow" button
   - Wait for deployment to complete
   - Check workflow summary for deployment URL

   **c. Verify production**
   - Check production site is working
   - Monitor logs for any errors
   - Verify database changes are reflected

### Why This Process?

Production deployments from main are **disabled via Vercel's Ignored Build Step** to prevent:

- Code deploying before database migrations complete
- Schema mismatches causing runtime errors
- Production downtime from race conditions

The manual process ensures migrations always complete before code deployment.

### Vercel Configuration

**Ignored Build Step** is configured with:

```bash
if [ "$VERCEL_ENV" = "production" ]; then exit 0; else exit 1; fi
```

**Vercel Ignored Build Step logic:**

- `exit 0` → "Yes, ignore this build" → Vercel **skips** the build
- `exit 1` → "No, don't ignore this build" → Vercel **proceeds** with build

The command answers "Should I ignore this build?" (not standard shell success/failure logic).

This allows:

- ✅ Preview deployments (PRs) - Auto-deploy
- ✅ Staging environment - Auto-deploy from main
- ❌ Production environment - Manual deploy only

### Rollback Procedure

If production deployment fails:

1. **Code rollback**:
   - Vercel Dashboard → Deployments
   - Find previous working deployment
   - Click "⋯" menu → "Promote to Production"

2. **Database rollback**:
   - Database migrations may not be easily reversible
   - Contact team lead for assistance
   - May require manual SQL fixes

**Prevention**: Always test thoroughly in staging before production deployment.

## Commit Message Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:

```
<type>(<scope>): <subject>

<body>
```

**Type:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`

**Scope (optional):** Component, feature, or area of the codebase affected

**Subject:** Concise, imperative present tense ("add" not "added" or "adds")

**Body (optional):** Detailed explanation of what and why (not how)

**Examples:**

- `feat(auth): Add OAuth login support`
- `fix(ui): Resolve alignment issue in mobile header`
- `docs: Update installation instructions`
- `chore(deps): Update Next.js to 15.5.3`
- `test(hooks): Add tests for useAuth hook`

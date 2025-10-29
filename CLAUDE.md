# Honkadori - Code Guidelines

In conversational responses, prioritize brevity. Keep explanations concise and direct.

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
- [Performance & Optimization](#performance--optimization)
- [Review Focus](#review-focus)
- [Git Branch Workflow](#git-branch-workflow)
- [Pull Request Workflow](#pull-request-workflow)
- [CI Pipeline](#ci-pipeline)
- [Production Deployment Process](#production-deployment-process)
- [Commit Message Conventions](#commit-message-conventions)
- [MCP Server Configuration](#mcp-server-configuration)
  - [Custom Slash Commands](#custom-slash-commands)
  - [Permission Presets](#permission-presets)
  - [Development Environment Health Check](#development-environment-health-check)
- [Cyrus/Linear Integration](#cyruslinear-integration)
  - [What is Cyrus](#what-is-cyrus)
  - [Initial Setup](#initial-setup)
  - [Configuration](#configuration)
  - [Usage Workflow](#usage-workflow)
  - [Monitoring and Troubleshooting](#monitoring-and-troubleshooting)

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

### Text Casing Convention

Use **sentence case** for all UI text elements (buttons, headings, labels, links):

**DO:**

- Button text: "Sign in", "Sign up", "Sign out"
- Headings: "Create account", "View profile"
- Labels: "Email address", "Password"

**DON'T:**

- ❌ "Sign In", "Sign Up", "Sign Out" (Title Case)
- ❌ "SIGN IN" (ALL CAPS)

**Exception:** Single-word headings/labels don't change (e.g., "Profile", "Settings")

This applies to:

- Button text and loading states
- Page headings and card titles
- Form labels and descriptions
- Links and navigation text

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

**Important:** Always wrap environment variable values containing special shell characters (`&`, `?`, `=`, etc.) in double quotes:

```bash
# ❌ Wrong - shell will parse & as a command separator
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require&channel_binding=require

# ✅ Correct - quotes prevent shell parsing issues
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require&channel_binding=require"
```

This is critical for database URLs and other values with query parameters. Without quotes, shell scripts that source `.env` (like `health-check.sh`) will fail to parse these variables correctly.

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

### E2E Testing with Playwright

E2E tests validate complete user workflows in a real browser. Tests are located in `/tests` or `/e2e` directory.

**Basic usage:**

```bash
# Run all E2E tests
pnpm test:e2e

# Run in headed mode (see browser)
pnpm test:e2e --headed

# Run in debug mode
pnpm test:e2e --debug

# Interactive test explorer
pnpm playwright test --ui
```

**Filtering and targeting:**

```bash
# Run tests matching pattern
pnpm test:e2e --grep "auth"
pnpm test:e2e --grep "sign-in"

# Run specific file
pnpm test:e2e tests/auth.spec.ts

# Specific browser
pnpm playwright test --project=chromium

# Exclude tests
pnpm test:e2e --grep-invert "slow"
```

**Debugging failures:**

```bash
# Show browser on failures
pnpm test:e2e --headed --retries=0

# Generate trace for analysis
pnpm test:e2e --trace on
pnpm playwright show-trace trace.zip

# Playwright Inspector
pnpm test:e2e --debug
```

**AI-assisted testing (Playwright MCP):**

With Playwright MCP server active, Claude can:

- Generate tests from natural language: "Write a test that signs in and verifies profile loads"
- Debug failures: "This test failed, analyze the screenshot"
- Update selectors: "Use better accessibility selectors in this test"

**Example E2E test:**

```typescript
import { test, expect } from '@playwright/test'

test('user can sign in', async ({ page }) => {
  await page.goto('/')
  await page.click('text=Sign in')

  await page.fill('input[type="email"]', 'test@example.com')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button:has-text("Sign in")')

  await expect(page).toHaveURL('/profile')
  await expect(page.locator('text=Welcome')).toBeVisible()
})
```

**Configuration:** `playwright.config.ts`

**Before deploying:** Always run E2E tests before major deployments

**Related:** Use `/test-auth` slash command for auth-specific test suite

### Creating New Components

When creating new React components, follow these patterns:

**Component locations (from File Organization):**

- **shadcn UI primitives** → `/components/ui` (use `npx shadcn@latest add <name>`)
- **Feature components** → `/components` root (reusable across routes)
- **Route-specific** → `/app/[route]/` (colocated with route)

**Client component template** (with interactivity):

```typescript
'use client'

import { useState } from 'react'

interface MyComponentProps {
  // Props here
}

export function MyComponent({ }: MyComponentProps) {
  const [state, setState] = useState()

  return <div>{/* Component JSX */}</div>
}
```

**Server component template** (default):

```typescript
interface MyComponentProps {
  // Props here
}

export function MyComponent({ }: MyComponentProps) {
  return <div>{/* Component JSX */}</div>
}
```

**Test template** (`MyComponent.test.tsx`):

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MyComponent } from './MyComponent'

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />)
    expect(screen.getByRole('...')).toBeInTheDocument()
  })
})
```

**Remember:**

- Use **Server Components by default** (no "use client")
- Only add `"use client"` if you need: interactivity, browser APIs, or React hooks
- Follow **sentence case** for all UI text
- Use **Typography components** (Heading, Body) for text
- See "Code Standards" section for full guidelines

## Performance & Optimization

### Bundle Analysis

Analyze your Next.js bundle to identify optimization opportunities.

**Quick analysis:**

```bash
pnpm build
# Next.js automatically outputs bundle analysis
# Look for "First Load JS" in build output
```

**Detailed analysis with @next/bundle-analyzer:**

```bash
# Install
pnpm add -D @next/bundle-analyzer

# Update next.config.ts:
# const withBundleAnalyzer = require('@next/bundle-analyzer')({
#   enabled: process.env.ANALYZE === 'true',
# })
# module.exports = withBundleAnalyzer(nextConfig)

# Run analysis
ANALYZE=true pnpm build
```

Opens interactive treemap showing package sizes and duplicates.

**Bundle metrics:**

- **Size**: Compressed JS (what users download)
- **First Load JS**: Total JS needed for page load

**Good targets:**

- First Load JS < 100 kB (excellent)
- First Load JS < 200 kB (good)
- First Load JS > 300 kB (needs optimization)

**Common optimizations:**

1. **Dynamic imports for heavy components:**

```typescript
const HeavyComponent = dynamic(() => import('@/components/HeavyComponent'))

// Client-only
const ClientOnly = dynamic(() => import('@/components/ClientOnly'), { ssr: false })
```

2. **Tree shaking:**

```typescript
// ❌ Bad - imports entire library
import _ from 'lodash'

// ✅ Good - imports specific function
import debounce from 'lodash/debounce'
```

3. **Replace large dependencies:**

- `moment` → `date-fns` or native `Intl.DateTimeFormat`
- Use npm Package Search MCP to find lightweight alternatives

4. **Check for duplicates:**

```bash
pnpm why <package-name>
```

**When to optimize:**

- Adding major dependencies
- Before deploying large features
- Performance feels slow
- First Load JS exceeds 200 kB

**Related:** Use Next.js DevTools MCP for AI-assisted optimization suggestions

## Review Focus

- Flag actual bugs and logic errors
- Suggest improvements only if they have clear value
- Skip nitpicking on formatting (Prettier handles it)
- Ensure tests are meaningful and cover the changes
- Watch for TypeScript strictness violations

## Git Branch Workflow

**CRITICAL: Never commit directly to the `main` branch.** Always create a feature branch first.

### Branch Naming Convention

Use descriptive branch names with prefixes:

- `feat/` - New features (e.g., `feat/auth-improvements`)
- `fix/` - Bug fixes (e.g., `fix/login-error`)
- `docs/` - Documentation only (e.g., `docs/update-readme`)
- `refactor/` - Code refactoring (e.g., `refactor/extract-utility`)
- `chore/` - Maintenance tasks (e.g., `chore/update-deps`)

### Proper Workflow - ALWAYS Follow These Steps

**BEFORE making any code changes:**

1. **Check current branch:**

   ```bash
   git branch --show-current
   ```

   - If on `main`: CREATE A FEATURE BRANCH FIRST (step 2)
   - If on a feature branch: You're good to proceed

2. **Create and switch to feature branch:**

   ```bash
   git checkout -b feat/your-feature-name
   ```

3. **Verify you're on the correct branch:**
   ```bash
   git branch --show-current  # Should show your feature branch, NOT main
   ```

**AFTER making code changes:**

4. **Stage changes:**

   ```bash
   git add -A
   git status  # Review what will be committed
   ```

5. **Run tests to ensure nothing is broken:**

   ```bash
   pnpm lint          # Check for linting errors
   pnpm type-check    # Verify TypeScript types
   pnpm test          # Run unit tests
   ```

   - Fix any failures before proceeding
   - If tests fail, fix the issues and re-stage changes
   - **Note:** These same checks run in CI when you create a PR. Running them locally first helps you catch issues early and speeds up the review process.

6. **Verify branch AGAIN before committing:**

   ```bash
   git branch --show-current  # MUST NOT be 'main'
   ```

7. **Create commit:**

   ```bash
   git commit -m "$(cat <<'EOF'
   type(scope): Brief description

   Detailed description of changes...

   🤖 Generated with [Claude Code](https://claude.com/claude-code)

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

8. **Push to remote:**

   ```bash
   git push -u origin feat/your-feature-name
   ```

9. **Create pull request:**

   **IMPORTANT:** PR title must follow Conventional Commits format (same as commit messages). Since we use squash-merge, the PR title becomes the final commit message in `main`.

   **Format:** `<type>(<scope>): <subject>`

   **Example titles:**
   - `feat(auth): Add password reset functionality`
   - `fix(ui): Resolve mobile header alignment`
   - `docs(git): Add branch workflow guardrails`

   ```bash
   gh pr create --title "feat(auth): Add password reset functionality" --body "$(cat <<'EOF'
   ## Summary
   ...

   ## Test plan
   ...

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

   **Tip:** See the **Pull Request Workflow** section below for guidance on updating PR descriptions when pushing additional commits.

### If You Accidentally Commit to Main

**DO NOT PANIC.** Fix it with these steps:

1. **Create feature branch from current state:**

   ```bash
   git branch feat/your-feature-name  # Creates branch but doesn't switch
   ```

2. **Reset main to match origin:**

   ```bash
   git reset --hard origin/main
   ```

3. **Switch to feature branch:**

   ```bash
   git checkout feat/your-feature-name
   ```

4. **Verify your commit is on the feature branch:**

   ```bash
   git log -1 --oneline  # Should show your commit
   ```

5. **Push feature branch and create PR:**
   ```bash
   git push -u origin feat/your-feature-name
   gh pr create ...
   ```

### Pre-Commit Checklist

Before running `git commit`, verify:

- [ ] Currently on a feature branch (NOT `main`)
- [ ] Changes are staged (`git status`)
- [ ] All tests pass (`pnpm lint && pnpm type-check && pnpm test`)
- [ ] Commit message follows Conventional Commits format
- [ ] PR title planned (must also follow Conventional Commits format)
- [ ] Ready to push and create PR

### Automated Branch Protection

We use a git pre-commit hook to automatically prevent commits to `main`. This hook is **already installed** in this project.

**What it does:**

- Blocks any commits to the main branch
- Displays helpful error message with instructions
- Reminds you to create a feature branch

**For new team members or after fresh clone:**

Run the setup script to install git hooks:

```bash
./scripts/setup-git-hooks.sh
```

This will install:

- Pre-commit hook that prevents commits to main
- (Future hooks as we add them)

**Bypassing the hook** (not recommended):

If you absolutely must commit to main:

```bash
git commit --no-verify
```

**Note:** Git hooks are local (`.git/hooks/` is not version controlled), so new team members need to run the setup script after cloning the repository.

## Pull Request Workflow

### Updating PR Descriptions

When pushing additional commits to an existing PR, always check if the PR description needs updating:

```bash
# Check current PR description
gh pr view --json title,body

# Review what changed in new commits
git log origin/main..HEAD --oneline
```

**Update the description if:**

- New features or fixes were added
- Implementation approach changed significantly
- Test plan needs updating
- Breaking changes were introduced
- File renames or structural changes occurred
- Scope of the PR expanded or changed

**Update using:**

```bash
gh pr edit --body "$(cat <<'EOF'
Updated description here...
EOF
)"
```

**When NOT to update:**

- Minor refactoring with same outcome
- Fixing typos or formatting
- Addressing review comments without changing scope
- Small bug fixes within the original scope

Keeping PR descriptions current helps reviewers understand the full context and ensures accurate documentation in git history (especially important for squash-merge).

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

## MCP Server Configuration

This project uses the Model Context Protocol (MCP) to enhance Claude Code's capabilities with specialized tools and context providers optimized for our hybrid human+AI workflow.

### What is MCP?

MCP (Model Context Protocol) is an open protocol that standardizes how AI assistants connect to data sources and tools. Think of it as "USB-C for AI" - a universal standard that allows Claude Code to access specialized functionality through modular servers.

**Key benefits for our workflow:**

- **Context-aware assistance**: Servers provide domain-specific knowledge (Better Auth docs, library documentation)
- **Enhanced capabilities**: File operations, database queries, sequential thinking, persistent memory
- **Reduced friction**: Pre-configured servers eliminate repetitive setup and explanation
- **Team consistency**: Shared `.mcp.json` ensures everyone has the same tools

### Configured MCP Servers

Our project uses the following MCP servers (configured in `.mcp.json`):

#### 1. **Filesystem Server** (Official Anthropic)

- **Purpose**: Secure file operations with enhanced capabilities
- **Capabilities**: Advanced file search, directory navigation, recursive operations
- **Scope**: Project root (configured via `PROJECT_ROOT` environment variable)
- **When to use**: Complex file operations, bulk changes, deep directory exploration

#### 2. **GitHub Server** (Official Anthropic)

- **Purpose**: Direct GitHub API integration
- **Capabilities**: Repository insights, PR management, issue tracking, workflow triggers
- **Requirements**: `GITHUB_PERSONAL_ACCESS_TOKEN` environment variable
- **When to use**: Complex GitHub operations beyond `gh` CLI capabilities

**Setup GitHub token:**

1. Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Create token with permissions: `repo`, `workflow`, `read:org`
3. Add to `.env`: `GITHUB_PERSONAL_ACCESS_TOKEN=github_pat_...`

#### 3. **Sequential Thinking Server** (Official Anthropic)

- **Purpose**: Enhanced multi-step planning and problem decomposition
- **Capabilities**: Structured reasoning, iterative refinement, complex architecture decisions
- **When to use**: Complex features, architectural planning, debugging tricky issues
- **Note**: No API keys required

#### 4. **Memory Server** (Official Anthropic)

- **Purpose**: Knowledge graph-based persistent memory across sessions
- **Capabilities**: Store project decisions, architecture patterns, context retention
- **When to use**: Document important decisions, track evolving patterns, maintain context
- **Note**: Memory persists across Claude Code sessions

#### 5. **Playwright Server** (Microsoft)

- **Purpose**: Browser automation and E2E test generation/debugging
- **Capabilities**:
  - Generate tests from natural language requirements
  - Debug test failures with AI analyzing screenshots
  - Automate browser interactions for testing
  - Web scraping and interaction
- **When to use**: Writing new E2E tests, debugging test failures, automating browser tasks
- **Note**: Works with your existing Playwright setup

#### 6. **MDN Lookup Server**

- **Purpose**: MDN Web Docs quick reference
- **Capabilities**: Search and retrieve Web API documentation (fetch, localStorage, DOM APIs, etc.)
- **When to use**: Need quick reference for web platform APIs without browser context switching
- **Note**: Complements Context7 for web-specific documentation

#### 7. **npm Package Search Server**

- **Purpose**: npm registry search and package metadata
- **Capabilities**:
  - Search npm packages by keyword
  - Get package metadata, versions, dependencies
  - Compare package alternatives
  - Check download statistics
- **When to use**: Evaluating new dependencies, checking package versions, finding alternatives
- **Note**: Helps make informed dependency decisions

#### 8. **Next.js DevTools Server** (Vercel)

- **Purpose**: Next.js-specific development assistance
- **Capabilities**:
  - Analyze app structure and routes
  - Get Next.js best practice recommendations
  - Identify optimization opportunities
  - Future: Automated Next.js upgrades
- **When to use**: Working on Next.js-specific features, planning upgrades, optimizing performance
- **Note**: Particularly useful for major Next.js version upgrades

#### 9. **Better Auth MCP** (HTTP server)

- **Purpose**: Better Auth documentation search and AI chat
- **Capabilities**: Search Better Auth docs, get implementation examples
- **When to use**: Implementing auth features, troubleshooting Better Auth issues
- **Note**: Already configured globally via HTTP

#### 10. **Context7** (HTTP server)

- **Purpose**: General library documentation retrieval
- **Capabilities**: Up-to-date docs for any npm package or library
- **When to use**: Need API docs for third-party libraries
- **Note**: Already configured globally via HTTP

### Verifying MCP Server Status

Check which servers are active and their connection status:

```bash
claude mcp list
```

**Expected output:**

- ✓ Connected - Server is working
- ✗ Failed to connect - Check configuration or API keys

### Adding New MCP Servers

**Project-wide servers** (recommended for team-shared tools):

1. Edit `.mcp.json` in project root
2. Add server configuration:

```json
{
  "mcpServers": {
    "your-server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-name"],
      "env": {
        "API_KEY": "${YOUR_API_KEY}"
      }
    }
  }
}
```

3. Commit `.mcp.json` to share with team
4. Restart Claude Code

**Personal servers** (local experiments):

Use local scope with Claude Code CLI:

```bash
claude mcp add --transport stdio your-server -- npx -y @modelcontextprotocol/server-name
```

### Troubleshooting MCP Servers

**Server shows "Failed to connect":**

1. Check server is properly installed: `npx -y @modelcontextprotocol/server-name --version`
2. Verify environment variables are set (check `.env`)
3. Restart Claude Code
4. Check server logs: `claude mcp get server-name`

**Environment variables not working:**

- MCP supports `${VAR}` and `${VAR:-default}` syntax in `.mcp.json`
- Variables are read from `.env` file in project root
- Restart Claude Code after changing `.env`

**GitHub server authentication:**

- Token must have correct scopes: `repo`, `workflow`, `read:org`
- Token must be fine-grained (not classic)
- Add to `.env`: `GITHUB_PERSONAL_ACCESS_TOKEN=github_pat_...`

### Custom Slash Commands

We've created custom slash commands for common workflows. These are stored in `.claude/commands/` and provide quick access to frequent operations.

Available commands:

#### `/deploy-staging`

Trigger staging deployment and verify success. Guides you through:

- Checking git status
- Triggering staging workflow
- Monitoring deployment
- Verifying staging URL

#### `/deploy-production`

Production deployment checklist and workflow. Ensures:

- Pre-deployment verification
- Database migrations run first
- Code deploys after migrations
- Production verification steps

#### `/db-status`

Check database migration status across all environments:

- Local migration status
- Staging workflow history
- Production workflow history
- Useful database commands

#### `/test-auth`

Run all authentication tests:

- Unit tests for auth components
- Integration tests
- Manual testing checklist
- Quick access to Better Auth docs via MCP

#### `/review-ready`

Pre-commit quality checklist:

- Branch verification
- Linting
- Type checking
- Unit tests
- Commit message format guidance
- PR creation template

#### `/fix-lint`

Run linter with auto-fix enabled:

- Automatically fixes formatting and import issues
- Reviews remaining issues that need manual fixes
- Helps maintain code quality standards

#### `/check-deps`

Check for outdated packages and security vulnerabilities:

- Lists outdated dependencies
- Checks for security vulnerabilities
- Provides update strategies
- Shows dependency tree information

**Using slash commands:**

Type `/` in Claude Code to see available commands, then select one to execute. Commands are markdown files that provide context and guidance to Claude Code.

**Creating new commands:**

1. Create `.claude/commands/your-command.md`
2. Write markdown with instructions, checklists, and bash commands
3. Claude Code automatically detects and loads the command
4. Test with `/your-command`

### Permission Presets

We've configured automatic permission approval for common operations in `.claude/settings.local.json`. This reduces friction for routine tasks.

**Pre-approved operations:**

**GitHub CLI:**

- `gh api:*` - GitHub API calls
- `gh pr view:*` - View pull requests
- `gh pr create:*` - Create pull requests
- `gh pr list:*` - List pull requests
- `gh issue list:*` - List issues
- `gh run view:*` - View workflow runs
- `gh run list:*` - List workflow runs
- `gh run watch:*` - Watch workflow execution
- `gh workflow run:*` - Trigger workflows

**Git commands:**

- `git checkout:*` - Branch switching and file restoration
  - ⚠️ **Note:** Auto-approved for workflow convenience, but can switch branches and restore files without confirmation. Use with awareness.
- `git status:*` - Repository status
- `git branch:*` - Branch operations
- `git log:*` - Commit history
- `git diff:*` - View changes

**pnpm scripts:**

- `pnpm lint:*` - Linting
- `pnpm type-check:*` - Type checking
- `pnpm test:*` - Testing
- `pnpm db:*` - Database operations
- `pnpm outdated:*` - Check outdated dependencies
- `pnpm audit:*` - Security audits
- `pnpm why:*` - Dependency tree investigation
- `pnpm build:*` - Build commands
- `pnpm playwright:*` - Playwright E2E tests

**MCP tools:**

- `mcp__better-auth__search` - Better Auth documentation search
- `mcp__context7__resolve-library-id` - Library ID resolution
- `mcp__context7__get-library-docs` - Library documentation retrieval

**Other tools:**

- `WebSearch` - Web search for up-to-date information

**Why pre-approve?**

These operations are:

- **Safe**: Read-only or locally scoped
- **Frequent**: Used in most development sessions
- **Predictable**: Well-understood behavior
- **Reversible**: Can be undone if needed

**Operations requiring approval:**

Operations NOT pre-approved require manual approval:

- `git commit` / `git push` (intentional - review changes first)
- Destructive git operations (`git reset --hard`, `git push --force`)
- File modifications (Edit, Write tools)
- Production deployments
- Any operations outside the pre-approved list

### Best Practices for MCP Usage

1. **Check server status regularly**: Run `/mcp` to verify all servers are connected
2. **Document decisions**: Use Memory MCP to store important architecture decisions
3. **Use Sequential Thinking for complex tasks**: Invoke it explicitly for architectural planning
4. **Leverage Better Auth MCP**: Instead of web searches, ask Better Auth MCP directly
5. **Keep environment variables secure**: Never commit `.env` file, use `.env.example` for documentation
6. **Share improvements**: If you add a useful MCP server, commit `.mcp.json` and document it here

### Database Operations (Without Postgres MCP)

We intentionally exclude the Postgres MCP server because our existing tools provide better workflows:

**For data inspection and editing:**

```bash
pnpm db:studio  # Opens Prisma Studio GUI
```

- Visual interface with relationships
- Type-safe edits
- No SQL required

**For raw SQL queries:**

- **Option 1**: Neon Dashboard → SQL Editor (https://console.neon.tech)
- **Option 2**: Prisma raw queries in code:
  ```typescript
  await prisma.$queryRaw`SELECT ...`
  await prisma.$executeRaw`UPDATE ...`
  ```

**For schema operations:**

```bash
pnpm db:migrate        # Create new migration
pnpm db:migrate status # Check migration status
pnpm db:push          # Push schema without migration (dev only)
pnpm db:generate      # Regenerate Prisma Client
```

**When to reconsider Postgres MCP:**

- Complex analytical queries requiring EXPLAIN ANALYZE
- Database grows to 20+ tables with complex relationships
- Frequent database administration tasks
- Performance optimization beyond Prisma's capabilities

### MCP Resources

- **Official documentation**: [modelcontextprotocol.io](https://modelcontextprotocol.io)
- **Server repository**: [github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- **Claude Code MCP docs**: [docs.claude.com/en/docs/claude-code/mcp](https://docs.claude.com/en/docs/claude-code/mcp)
- **MCP server directory**: [mcpserverfinder.com](https://www.mcpserverfinder.com)

### Development Environment Health Check

The `health-check.sh` script validates your complete development environment setup to ensure everything is configured correctly for AI-assisted development.

**What it checks:**

- **Required tools**: Node.js, pnpm, Claude Code CLI, Git (with correct versions)
- **Project structure**: Git repository, hooks installation, required config files
- **Environment variables**: All required vars are set (including `PROJECT_ROOT` for MCP)
- **Dependencies**: node_modules exists and is in sync with lock file
- **Code quality**: TypeScript compilation and linting pass
- **MCP configuration**: MCP servers are properly configured

**Usage:**

```bash
# Run from project root
./scripts/health-check.sh
```

**When to use:**

- **After cloning the repository** - Verify your environment is set up correctly
- **When onboarding new team members** - Quick validation of their setup
- **When something's not working** - Identify missing configuration or tools
- **Before submitting a PR** - Ensure your environment is healthy
- **After updating dependencies** - Verify everything still works

**Exit codes:**

- `0` - All checks passed (or only warnings)
- `1` - One or more errors found (must be fixed)

**Example output:**

```
🏥 Running development environment health check...

📋 Checking required tools...
✅ Node.js installed: v22.15.0
✅ pnpm installed: 10.9.0
✅ Claude Code CLI installed
✅ Git installed: git version 2.43.0

🔐 Checking environment variables...
✅ .env file exists
✅ BETTER_AUTH_SECRET is set
✅ DATABASE_URL is set
✅ PROJECT_ROOT is set (for MCP)

🎉 All checks passed! Your development environment is healthy.
```

**Fixing issues:**

The script provides specific error messages and suggested fixes for each issue found. Common fixes:

- Install missing tools: `brew install node` or `npm install -g pnpm`
- Set up git hooks: `./scripts/setup-git-hooks.sh`
- Configure environment: Copy `.env.example` to `.env` and fill in values
- Install dependencies: `pnpm install`
- Fix code issues: `pnpm lint --fix`, then address remaining errors

### Future MCP Enhancements

Potential additions to consider:

#### When Codebase Grows Larger

- **Serena MCP** ([github.com/oraios/serena](https://github.com/oraios/serena)): Semantic code analysis via Language Server Protocol
  - **When to add**: Codebase grows to 100+ files or 10K+ lines
  - **Current status**: 35 files, ~3K lines (too small to benefit)
  - **Benefits**: Symbol-level code navigation, precise editing, reduced token usage
  - **Tools provided**: `find_symbol`, `find_referencing_symbols`, `insert_after_symbol`
  - **Requirements**: Install `uv` tool (`brew install uv` or `pip3 install uv`)
  - **Installation**: `claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context ide-assistant --project "$(pwd)"`
  - **Note**: Works best for large codebases with complex cross-file dependencies; minimal benefit for small projects

**Monitor codebase growth:**

```bash
# Check current file count
find src -type f \( -name "*.ts" -o -name "*.tsx" \) | wc -l
# When this hits ~100+, consider adding Serena
```

#### Other Tools

- **Sentry MCP**: Error monitoring and log querying (if we add Sentry)
- **Puppeteer MCP**: Automated browser testing and screenshots
- **Slack MCP**: Deployment notifications (if we use Slack)
- **Custom MCP server**: Project-specific tools (component generator, etc.)

When adding new servers, update this documentation and commit `.mcp.json` to share with the team.

## Cyrus/Linear Integration

**Cyrus** is an autonomous AI development agent that integrates with Linear issue tracking and Claude Code. It monitors Linear issues assigned to it, automatically creates isolated Git worktrees for each task, executes Claude Code sessions to process them, and posts results back to Linear as comments—all running locally on your machine.

### What is Cyrus

Cyrus enables fully automated issue processing:

- **Autonomous workflow**: Detects Linear issues assigned to Cyrus bot, creates worktrees, and processes them without manual intervention
- **Isolated environments**: Each issue gets its own Git worktree, preventing conflicts between concurrent tasks
- **AI-powered development**: Uses Claude Code to understand requirements, make changes, and solve problems
- **Linear integration**: Posts progress updates and results as Linear comments, creates PRs if needed
- **Security controls**: Granular tool permissions control what Cyrus can do (read-only, safe mode, full access)

**Current configuration**: Safe mode (can read/edit files and run git commands, but no bash/shell execution)

### Initial Setup

**Setting up Cyrus on a new machine requires three steps:**

1. **Install Cyrus CLI**
2. **Deploy the proxy worker** (self-hosted)
3. **Configure Cyrus** to connect to Linear

#### Step 1: Install Cyrus CLI

```bash
npm install -g cyrus-ai
```

Verify installation:

```bash
cyrus --version  # Should show 0.1.57 or later
```

#### Step 2: Deploy Self-Hosted Proxy

The proxy handles OAuth with Linear and webhooks. Follow the detailed guide in `cyrus-proxy/`:

```bash
cd cyrus-proxy
cp wrangler.toml.example wrangler.toml
# Then follow cyrus-proxy/QUICKSTART.md for complete deployment steps
```

**Quick summary of proxy deployment:**

1. Install Wrangler CLI: `npm install -g wrangler`
2. Login to Cloudflare: `wrangler login`
3. Create KV namespaces
4. Update `wrangler.toml` with namespace IDs
5. Deploy: `pnpm run deploy`
6. Create Linear OAuth app with callback URLs
7. Configure secrets: `wrangler secret put`
8. Set `PROXY_URL` environment variable

See [cyrus-proxy/QUICKSTART.md](./cyrus-proxy/QUICKSTART.md) for step-by-step instructions.

#### Step 3: Configure Cyrus

Once the proxy is deployed and `PROXY_URL` is set, run:

```bash
cyrus
```

This will:

1. **Connect Linear via OAuth** - Opens browser for Linear authentication
2. **Configure repository** - Prompts for repository path and settings
3. **Set tool permissions** - Choose security level (use "safe" mode)
4. **Save configuration** - Creates `~/.cyrus/config.json`

**Recommended configuration:**

When prompted, use these settings:

- **Repository path**: `/path/to/honkadori` (use your actual project path)
- **Allowed tools**: `safe` (read/edit files + git commands, no bash)
- **MCP config**: `.mcp.json` (uses project's existing MCP setup)

**What happens during setup:**

The configuration wizard will:

- Ask for Linear OAuth authorization (opens browser)
- Prompt for repository details
- Ask about tool permissions (choose "safe")
- Optionally configure MCP servers (point to `.mcp.json`)
- Create `~/.cyrus/config.json` with your settings

### Configuration

**Configuration file location**: `~/.cyrus/config.json`

**Repository setup script**: `.claude/cyrus-setup.sh`

This script runs automatically when Cyrus creates a new worktree. It:

- Installs dependencies with `pnpm install`
- Generates Prisma client
- Runs health check to verify environment
- Prepares worktree for development

**Available environment variables in setup script:**

- `LINEAR_ISSUE_IDENTIFIER` - Issue ID (e.g., "HON-123")
- `LINEAR_ISSUE_TITLE` - Issue title
- `CYRUS_REPO_PATH` - Path to the worktree

**Security configuration (Safe Mode)**:

Current permissions allow Cyrus to:

- ✅ Read all project files
- ✅ Edit and write files
- ✅ Run git commands (checkout, commit, push, branch)
- ✅ Use TodoWrite for task tracking
- ✅ Access MCP servers (Better Auth docs, Context7, etc.)
- ❌ Execute bash/shell commands
- ❌ Run npm/pnpm commands directly

This prevents accidental system changes while allowing full code development.

**Editing configuration:**

```bash
# View current config
cat ~/.cyrus/config.json

# Edit config
vi ~/.cyrus/config.json

# Or edit repository setup script
vi .claude/cyrus-setup.sh
```

### Usage Workflow

**Starting Cyrus:**

```bash
# Using convenience script (recommended)
./scripts/cyrus-start.sh

# Or directly
cyrus
```

Cyrus will run continuously, monitoring Linear for assigned issues.

**Assigning issues to Cyrus:**

1. Create or open an issue in Linear
2. Click the assignee field
3. Select "Cyrus" bot from the dropdown
4. Cyrus automatically detects the assignment and begins processing

**What Cyrus does:**

1. **Detects assignment** - Monitors Linear for issues assigned to Cyrus bot
2. **Creates worktree** - Runs `git worktree add` for isolated development
3. **Runs setup** - Executes `.claude/cyrus-setup.sh` to prepare environment
4. **Processes issue** - Uses Claude Code to understand and implement changes
5. **Posts results** - Comments on Linear issue with progress and results
6. **Creates PR** - Optionally creates pull request (if `gh` CLI is available)

**⚠️ Important: Safe mode limitation**

The current safe mode configuration blocks bash execution, which means `.claude/cyrus-setup.sh` cannot run automatically. You must either:

1. **Manual setup** (recommended): After Cyrus creates a worktree, manually run the setup commands:

   ```bash
   cd /path/to/worktree
   pnpm install
   pnpm db:generate
   ./scripts/health-check.sh
   ```

2. **Higher permission mode**: Switch Cyrus to a mode that allows bash execution (requires security review). Update `~/.cyrus/config.json` and change the `allowedTools` setting.

Current safe mode allows: read/edit files + git commands only (no bash/shell execution).

**Checking status:**

```bash
# Check Cyrus status and active worktrees
./scripts/cyrus-status.sh

# List all worktrees manually
git worktree list
```

**Cleaning up worktrees:**

Cyrus typically cleans up after itself, but you can manually remove worktrees:

```bash
# Remove a specific worktree
git worktree remove <path>

# Remove all worktrees
git worktree prune
```

### Monitoring and Troubleshooting

**Monitoring Cyrus:**

- Watch terminal output where Cyrus is running
- Check Linear issue comments for progress updates
- Use `./scripts/cyrus-status.sh` to see active worktrees
- Monitor git worktrees: `git worktree list`

**Common issues:**

**"Configuration not found"**:

- Run `cyrus` to complete initial setup
- Verify `~/.cyrus/config.json` exists

**"Linear authentication failed"**:

- Re-run `cyrus` to refresh OAuth token
- Check Linear workspace permissions

**"Worktree creation failed"**:

- Ensure main branch is clean: `git status`
- Check disk space: `df -h`
- Remove stale worktrees: `git worktree prune`

**"Setup script failed"**:

- Check `.claude/cyrus-setup.sh` for errors
- Verify environment variables are set
- Run health check manually: `./scripts/health-check.sh`

**"Claude Code session failed"**:

- Check MCP servers are running: `claude mcp list`
- Verify allowed tools configuration in `~/.cyrus/config.json`
- Check Claude Code authentication: `claude auth status`

**Useful commands:**

```bash
# Start Cyrus
./scripts/cyrus-start.sh

# Check status
./scripts/cyrus-status.sh

# View config
cat ~/.cyrus/config.json

# List worktrees
git worktree list

# Remove worktree
git worktree remove <path>

# View Cyrus logs (terminal where Cyrus is running)
# Press Ctrl+C to stop Cyrus
```

**Future enhancements:**

When ready to run Cyrus 24/7:

1. Deploy to VPS or cloud server
2. Set up webhooks for Linear events
3. Configure reverse proxy (nginx) or ngrok
4. Update configuration for server environment

**Label-based routing** (optional future enhancement):

- Route "bug" labeled issues to debugger mode
- Route "feature" labeled issues to builder mode
- Route "scope" labeled issues to scoping mode
- Configure via `labelPrompts` in `~/.cyrus/config.json`

**Resources:**

- **Cyrus repository**: [github.com/ceedaragents/cyrus](https://github.com/ceedaragents/cyrus)
- **Linear API docs**: [developers.linear.app](https://developers.linear.app)
- **Claude Code docs**: [docs.claude.com/claude-code](https://docs.claude.com/claude-code)

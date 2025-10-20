# Honkadori - Code Guidelines

## Project Overview

A Next.js 15 project with React 19, using TypeScript, Tailwind CSS, and shadcn/ui components.

## Tech Stack

- **Framework**: Next.js 15.5.3 with Turbopack
- **Language**: TypeScript 5.9
- **Styling**: Tailwind CSS 4.1 with class-variance-authority
- **Testing**: Vitest for unit tests, Playwright for E2E
- **Linting**: ESLint 9 + Prettier
- **Package Manager**: pnpm 10.9

## Code Standards

### TypeScript & Linting

- Strict TypeScript mode (`tsconfig.json`)
- ESLint rules enforced by CI
- Prettier formatting (run `pnpm format` before committing)
- Use `pnpm lint` to check for issues

### Testing

- Unit tests with Vitest in `.test.ts` files
- E2E tests with Playwright in `e2e/` directory
- Run `pnpm test` before submitting PRs
- Aim for meaningful test coverage, especially for hooks and utilities

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

### Setting Up Environment Variables

1. Copy `.env.example` to `.env.local`:

   ```bash
   cp .env.example .env.local
   ```

2. Fill in required values in `.env.local` (never commit this file)

3. Environment validation happens automatically on app startup in `src/lib/env.ts`

### Using Environment Variables in Code

Import the `env` object anywhere in your code:

```typescript
import { env } from '@/lib/env'

// Type-safe access to env vars
console.log(env.NEXT_PUBLIC_APP_NAME)

// Optional vars are typed as string | undefined
if (env.NEXT_PUBLIC_APP_URL) {
  console.log(env.NEXT_PUBLIC_APP_URL)
}

// NODE_ENV is managed by Next.js, access it directly from process.env
if (process.env.NODE_ENV === 'development') {
  console.log('Running in development mode')
}
```

### Adding New Environment Variables

1. Add the variable to the schema in `src/lib/env.ts`:

   ```typescript
   const envSchema = z.object({
     // ... existing vars
     MY_NEW_VAR: z.string().optional(),
     // or required: z.string()
   })
   ```

2. Document it in `.env.example`:

   ```bash
   # MY_NEW_VAR=my-value
   ```

3. Use the type-safe `env` object in your code

All environment variables are validated at startup with clear error messages if validation fails.

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

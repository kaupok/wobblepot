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

- `Blockquote`: includes `pl-6` (padding needed for border design)
- `Ul`/`Ol`: include `my-6 ml-6` (spacing needed for list usability)
- `Pre`: includes `p-4` (padding needed for code block presentation)

**Example - DO:**

```tsx
<div className="mb-6">
  <Body variant="muted">Error ID: 12345</Body>
</div>
```

**Example - DON'T:**

```tsx
<Body variant="muted" className="mb-6 block">
  Error ID: 12345
</Body>
```

#### Other Components

- `Blockquote` - Semantic blockquote with left border and padding
- `Ul`/`Ol`/`Li` - Semantic lists with built-in spacing
- `Code` - Inline code with styling
- `Pre` - Code blocks with scrolling and padding

## Review Focus

- Flag actual bugs and logic errors
- Suggest improvements only if they have clear value
- Skip nitpicking on formatting (Prettier handles it)
- Ensure tests are meaningful and cover the changes
- Watch for TypeScript strictness violations

## CI Pipeline

All changes must pass: `pnpm lint && pnpm type-check && pnpm test && pnpm test:e2e`

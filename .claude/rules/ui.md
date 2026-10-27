---
paths:
  - "src/**/*.tsx"
  - "src/**/*.css"
---

# UI rules

## Styling

- Tailwind with shadcn/ui; `tailwind-merge` for dynamic classes; no inline styles
- A new `--spacing-*` token in `globals.css` also goes into `CUSTOM_SPACING_VALUES` in `src/lib/utils.ts` (docs/DESIGN.md → Spacing)

`pnpm lint` enforces six `@shadcn/lint` rules on `src/**` (not tests or stories). Each message names the token or variant to use.

- **`no-restyle`:** a page may _place_ a component (width, margin, flex/grid). What the component owns (padding, radius, colour, type, height) comes from a variant or size prop, so add one rather than a `className` override. Exceptions: the `contracts` in `eslint.config.mjs`, and `src/components/ui/**`.
- **`no-arbitrary-values`** is off only for primitives `shadcn add` installed, listed in `eslint.config.mjs`.
- **Every escape hatch carries a one-line reason** (`allow` entries, `eslint-disable` for `shadcn/*`). A tokenless value that several callsites need becomes an `@utility` in `globals.css`.

## Typography Components

`Heading` (levels plus an `as` prop for the tag), `Body` (variants plus `tone`), `Blockquote`, `Ul`/`Ol`/`Li`, `Code`, `Pre`; form errors use `FieldError`.

**Core rule:** size and weight come from `variant`, colour from `tone`. Apply layout on a wrapper: `<div className="mt-4"><Heading>Title</Heading></div>`, never `<Heading className="mt-4">`. `shadcn/no-restyle` fails `pnpm lint` on a `text-*`, `font-*` or `m*-*` class on a type primitive. A list that sheds its prose margins takes `variant="plain"`. Guide: docs/TYPOGRAPHY.md.

## Storybook

A component under `src/components` gets a colocated `.stories.tsx`, created or updated in the same change, covering its variants and key states. `pnpm stories:check` fails on a missing file; exceptions are in `scripts/check-colocated-stories.ts`. Every story passes the axe a11y gate (`pnpm test-storybook:ci`). Coverage, conventions, play functions and waivers: `.storybook/README.md`.

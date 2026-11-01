---
paths:
  - "src/**/*.tsx"
  - "src/**/*.css"
---

# UI rules

## Styling

- Tailwind with shadcn/ui; `tailwind-merge` for dynamic classes; no inline styles
- A new `--spacing-*` token in `globals.css` also goes into `CUSTOM_SPACING_VALUES` in `src/lib/utils.ts` (docs/DESIGN.md → Spacing)

`pnpm lint` enforces the `@shadcn/lint` rules on `src/**`, and each message names the token or variant to use.

- **Add a variant or size prop, not a `className` override,** for what a component owns (padding, radius, colour, type, height). A page only _places_ it (width, margin, flex/grid).
- **Every escape hatch carries a one-line reason** (`allow` entries, `eslint-disable` for `shadcn/*`). A tokenless value that several callsites need becomes an `@utility` in `globals.css`.

## Typography Components

`Heading` (levels plus an `as` prop for the tag), `Body` (variants plus `tone`), `Blockquote`, `Ul`/`Ol`/`Li`, `Code`, `Pre`; form errors use `FieldError`.

**Core rule:** size and weight come from `variant`, colour from `tone`. Layout goes on a wrapper, not on the primitive (`pnpm lint`). A list that sheds its prose margins takes `variant="plain"`. Guide: docs/TYPOGRAPHY.md.

## Storybook

A component under `src/components` gets a colocated `.stories.tsx`, created or updated in the same change, covering its variants and key states. `pnpm stories:check` fails on a missing file; exceptions are in `scripts/check-colocated-stories.ts`. Every story passes the axe a11y gate (`pnpm test-storybook:ci`). Coverage, conventions, play functions and waivers: `.storybook/README.md`.

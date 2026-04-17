# Storybook — play-function interaction tests

Stories can include a `play` function to exercise the component under
`@storybook/test-runner` (run in CI via `pnpm test-storybook:ci`). Use this to
cover parent-callback contracts that aren't easily tested end-to-end: modal
open/close, keyboard handling, form submission, selection.

## Imports

All test utilities come from the bundled `storybook/test` entry point —
`@vitest/spy`-backed `fn()` / `expect`, plus Testing Library queries, `userEvent`
and `waitFor`:

```tsx
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
```

## Portal content (Radix Dialog / Select)

Radix components render through a React portal outside the story's
`canvasElement`. Query from `document.body` instead:

```tsx
play: async ({ args }) => {
  const body = within(document.body)
  const dialog = await body.findByRole('dialog')
  // ...
}
```

## Wiring spies

Declare callback args as `fn()` spies in `meta.args` (or per story). The spy
instance is injected into `play` via `args`, and every call is recorded:

```tsx
const meta = {
  args: { onConfirm: fn() },
  // ...
}

export const Confirms: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: /confirm/i }))
    await expect(args.onConfirm).toHaveBeenCalledTimes(1)
  },
}
```

## Awaiting async flows

`userEvent` returns after synchronous updates, not after `await fetch(...)` in
the component. Wrap the assertion in `waitFor` when a callback fires after an
awaited request (e.g. after MSW resolves a PATCH):

```tsx
await userEvent.click(selectButton)
await waitFor(() => expect(args.onSwapComplete).toHaveBeenCalled())
```

## Data-fetching stories

MSW handlers in `src/stories/msw-handlers.ts` back default query responses.
Play functions that exercise selection or mutation hit the same PATCH/POST
handlers — no per-story wiring needed unless you want a specific state.

## Examples in-repo

- `src/components/meal-plan/MealDetailModal.stories.tsx` — serving / note
  editing, Escape-to-close.
- `src/components/meal-plan/MealSelectorModal.stories.tsx` — search → select
  flow with MSW-backed PATCH.
- `src/components/meal-plan/PantryDeductionModal.stories.tsx` — confirm / cancel
  footer buttons.

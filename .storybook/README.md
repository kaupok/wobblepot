# Storybook — conventions

## Viewport — mobile-first default

Honkadori is a mobile-first web app, so every story **opens at a 390×844 mobile
viewport** (`mobileIphone`) by default. This matches modern iPhone dimensions
and makes it impossible to backfill a nav story without noticing mobile-only
layout issues.

Custom viewports (defined in `.storybook/preview.tsx`):

- `mobileIphone` — 390×844 (iPhone 13/14) — **default**
- `mobilePixel` — 360×640 (Android-class)
- Plus Storybook's built-in `MINIMAL_VIEWPORTS` (`mobile1` 320×568, `mobile2`
  414×896, `tablet` 834×1112, `desktop` 1280×1024)

### When to add a desktop variant

If the component's layout changes at `md:` (or any other breakpoint), add an
explicit `Desktop` story by overriding the viewport via `globals`:

```tsx
export const Desktop: Story = {
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
}
```

Do **not** add desktop variants to every story — only the ones where layout
actually branches. Presentational primitives (badges, inputs, typography) don't
need them.

The toolbar lets you toggle the viewport manually for exploration.

---

## Play-function interaction tests

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

## Modal a11y play-function conventions

The axe a11y gate catches **static** violations — missing labels, low contrast,
bad ARIA. It cannot see **interaction-level** a11y: focus trap on open, tab
order within the dialog, Escape handling, close-sequence completion. Every
modal story file must include a play function that asserts these invariants.

Focus-restore on close is intentionally not asserted in Storybook — it's a
Radix contract tied to the real trigger at the real callsite, not per-modal
code, and the headless test-runner env can't reliably observe it. E2E owns
that assertion (see HON-446).

### Helpers

Use the shared helpers in `src/stories/a11y-helpers.ts`:

- `assertFocusInDialog()` — focus moved into the open dialog
- `assertTabStaysInDialog(count = 10)` — tabbing doesn't escape the dialog
- `awaitDialogClosed(timeoutMs = 2000)` — waits for dialog to fully unmount. Our Radix Dialog has a 200ms fade-out animation; during that time the dialog stays in the DOM with `data-state="closed"` and FocusScope hasn't cleaned up yet. Awaiting unmount is a proxy for "close sequence completed" and catches real regressions (a dialog that never closes, or whose focus trap outlives unmount).
- `openViaTrigger(trigger)` — Tab to the trigger and activate with Enter. Keyboard navigation is more reliable than `.focus()` or `.click()` in the headless test-runner.
- `pressEscape()` / `pressTab(count = 1)` — `userEvent` wrappers.

### The pattern

Most of our modals are controlled-open (receive `open`/`onOpenChange` props).
Wrap them with a local render function that provides a trigger button and
controlled state. Use `awaitDialogClosed` as the close-sequence assertion.

```tsx
import { useState } from 'react'
import { expect, waitFor, within } from 'storybook/test'
import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
  openViaTrigger,
  pressEscape,
} from '@/stories/a11y-helpers'

export const A11yInteractionPatterns: Story = {
  args: { open: false },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div>
        <button type="button" data-testid="a11y-trigger" onClick={() => setOpen(true)}>
          Open modal
        </button>
        <MyModal
          {...args}
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            args.onOpenChange?.(next)
          }}
        />
      </div>
    )
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByTestId('a11y-trigger')

    await openViaTrigger(trigger)
    await assertFocusInDialog()
    await assertTabStaysInDialog()

    await pressEscape()
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
    await awaitDialogClosed()
  },
}
```

Modals that use a Radix `<DialogTrigger>` internally (like `AddMemberDialog`)
can skip the wrapper and click the real trigger directly, but the play-function
assertions are the same — focus-in, tab-stays-in, escape, await-closed.

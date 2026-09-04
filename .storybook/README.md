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
`@storybook/addon-vitest` (run in CI via `pnpm test-storybook:ci`, live in
watch mode via `pnpm test-storybook`). Use this to cover parent-callback
contracts that aren't easily tested end-to-end: modal open/close, keyboard
handling, form submission, selection.

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

## Scenario stories

Everything under `Scenarios/*` (in `src/stories/scenarios/`) is a **composite**:
a whole screen, or the meaningful chunk of one, assembled from existing feature
components. Component-level stories cannot violate "no cards inside cards" or
"actions sit on the title row" — those rules only become visible once
components are composed, so this is where `docs/DESIGN.md` gets exercised.

Rules:

- **Fixed props, not live data.** Compose real components with hard-coded props
  from `src/stories/fixtures.ts`. Add a factory there if a shape is missing;
  never inline data that duplicates an existing fixture. Stability beats
  realism — a scenario is a baseline, and later a visual-regression baseline
  (HON-439).
- **MSW is the exception, not the pattern.** A component that owns its queries
  (`MealSelectorModal`) runs on the _default_ handlers from
  `src/stories/msw-handlers.ts`, which are fixed fixtures already exercised in
  CI. Do not add per-story handler overrides that introduce loading or error
  states — those belong in the component's own story file.
- **Mobile by default.** Scenarios inherit the 390×844 viewport. Add a
  `Desktop` variant only where the composed layout actually branches at a
  breakpoint (see "When to add a desktop variant" above).
- **Every scenario asserts the design rules** from its `play` function, and
  carries `tags: ['autodocs']`.

### The design-rule helper

`src/stories/design-rules.ts` exports `assertDesignRules(root, rules)` — the
mechanical half of `docs/DESIGN.md`. It throws on the first violation with the
rule name, the DESIGN.md section, and the first 120 characters of the offending
element, so a violation fails `pnpm test-storybook:ci` instead of waiting for a
reviewer to notice.

| Rule                | Fails when                                                          |
| ------------------- | ------------------------------------------------------------------- |
| `no-nested-cards`   | `[data-slot="card"]` has a `[data-slot="card"]` descendant          |
| `title-scale`       | an `h1`–`h6` computes above 20px (the `Heading variant="h4"` Title) |
| `no-sticky-content` | anything computes to `position: sticky` or `fixed`                  |
| `no-raw-palette`    | a `class` attribute carries a raw Tailwind palette class            |

`SCENARIO_RULES` (all four) is exported alongside it — scenarios enable the
whole set rather than picking rules per story:

```tsx
import { assertDesignRules, SCENARIO_RULES } from '@/stories/design-rules'

export const Populated: Story = {
  play: async ({ canvasElement }) => {
    await assertDesignRules(canvasElement, SCENARIO_RULES)
  },
}
```

The helper checks the **subtree under** the root, never the root itself. That
is what lets a portal-rendering scenario pass the dialog element instead of
`canvasElement` — Radix renders dialog content outside the canvas, and
`DialogContent` is `position: fixed` by design, which is chrome hosting the
scenario rather than part of it:

```tsx
play: async () => {
  const body = within(document.body)
  const dialog = await body.findByRole('dialog')
  // Wait for real content — asserting against skeletons passes vacuously.
  await body.findAllByRole('button', { name: /^select$/i })
  await assertDesignRules(dialog, SCENARIO_RULES)
},
```

Interaction a11y for a modal composed into a scenario stays in that modal's own
story file (see below); a scenario asserts composition only, so the coverage
isn't duplicated.

### Adding one

1. Create `src/stories/scenarios/<Screen>.stories.tsx` with
   `title: 'Scenarios/<Screen>'`.
2. Compose the real components. If the screen has page chrome (a title card, a
   meta line), mirror how the real page component builds it — a local render
   component in the story file is fine, and keeps `satisfies Meta<typeof …>`
   type-safe.
3. Wire every callback to `fn()`.
4. Add the `play` function above.
5. Run `pnpm test-storybook:ci`. Fix real violations in the component; waive an
   axe false positive narrowly with a `// WHY:` comment, per CLAUDE.md.

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
- `openViaTrigger(trigger)` — Tab to the trigger and activate with Enter. Keyboard navigation is more reliable than `.focus()` or `.click()` in the headless test runner.
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

## Published build

The static build is public at <https://kaupok.github.io/wobblepot/>. The
`Deploy Storybook [GitHub Pages]` workflow
(`.github/workflows/deploy-storybook.yml`) rebuilds it on every push to `main`
that touches a build input (`src/`, `.storybook/`, `messages/`, `public/`, the
package manifest). Republish by hand from the Actions tab → "Run workflow" if
a run fails or Pages was just (re)enabled. CI also runs `pnpm build-storybook`
on every PR, so a broken static build fails the PR instead of the post-merge
deploy.

Pages serves the site from a sub-path (`/wobblepot/`), so anything that must
resolve at runtime has to be base-relative. Storybook's own assets already are;
the MSW service worker URL is the one we own — `initialize()` in `preview.tsx`
builds it from `import.meta.env.BASE_URL` so it stays `/mockServiceWorker.js`
in dev and the Vitest project and becomes `./mockServiceWorker.js` in the
static build. Keep that when touching the MSW setup, or every story on Pages
fails in the loader.

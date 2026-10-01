import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
  openViaTrigger,
  pressEscape,
} from '@/stories/a11y-helpers'
import {
  createMeal,
  lemonGarlicChickenComponentsFull,
  lemonGarlicChickenPantryWithOil,
} from '@/stories/fixtures'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { MealDetailModal } from './MealDetailModal'
import type { StructuredTips } from './types'

const mealFixture = createMeal({
  components: lemonGarlicChickenComponentsFull,
  description: 'Lemon-garlic roast chicken with crisp potatoes and a bright pan sauce.',
  timeMinutes: 45,
  kidFriendly: true,
  nutrition: { calories: 540, protein: 38, carbs: 41, fat: 22 },
})

/** A household meal with its illustration and the hue taken from it. */
const tintedMeal = {
  ...mealFixture,
  id: 'meal-with-image',
  isCustom: true,
  imageStatus: 'ready' as const,
  imageUrl: mealIllustration.src,
  imageHue: 52,
}

const tips: StructuredTips = {
  equipment: ['Sheet pan', 'Sharp knife', 'Tongs'],
  steps: [
    'Heat the oven to 220°C with a rack in the upper third.',
    'Pat the chicken dry, then season it with salt, pepper and a little olive oil.',
    'Spread the potatoes on the sheet pan, set the chicken on top skin-side up, and tuck the lemon halves and smashed garlic around it.',
    'Roast for 35 minutes, until the skin is deep golden and the juices run clear.',
    'Rest the chicken for 5 minutes, then squeeze the roasted lemon over everything.',
  ],
  pitfalls: [
    'Don’t crowd the pan, or the potatoes steam instead of crisping.',
    'Dry the skin well: wet skin never browns.',
  ],
  tip: 'Deglaze the hot pan with a splash of wine for a quick sauce.',
}

/** The tips route answering at once, with `tips`. */
const tipsHandler = http.post('/api/meal-plans/:planId/entries/:entryId/preparation-tips', () =>
  HttpResponse.json({ tips }),
)

const PHONE = { value: 'mobileIphone', isRotated: false }
const TABLET = { value: 'tabletLandscape', isRotated: false }
const LAPTOP = { value: 'laptop', isRotated: false }

const meta = {
  title: 'Meal plan/MealDetailModal',
  component: MealDetailModal,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The cook view (HON-932): what you open to cook a meal, and still how you look at one. Below `lg` it fills the screen; from `lg` it is a panel inset 24px, with the ingredients and the steps in two columns that scroll on their own. The whole panel is the meal’s tint. Type and targets are sized for a phone propped on a counter, and the screen stays on while it is open. Portal-based: queries go through `document.body`.',
      },
    },
    msw: { handlers: { tips: [tipsHandler] } },
  },
  args: {
    meal: mealFixture,
    householdSize: 4,
    open: true,
    onOpenChange: fn(),
    planId: 'plan-1',
    entryId: 'entry-1',
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    onServingOverrideChange: fn(),
  },
} satisfies Meta<typeof MealDetailModal>

export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)
/**
 * The open dialog, once its own enter animation (fade + zoom) has finished:
 * until then its opacity is below 1 and `toBeVisible` can fail on anything in
 * it. Only the dialog's own animations — a skeleton's pulse runs forever.
 */
async function findDialog(): Promise<HTMLElement> {
  const dialog = await body().findByRole('dialog')
  await Promise.all(dialog.getAnimations().map((animation) => animation.finished))
  return dialog
}

const px = (value: string) => Number.parseFloat(value)

// The viewport a fixed element fills, read off the dialog's own `inset-0`
// overlay: on a classic-scrollbar system `html` keeps a scrollbar gutter while
// the scroll lock is on (globals.css, HON-690), so `window.innerWidth` is
// wider than any fixed box. Phones have overlay scrollbars.
const overlay = () => document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!
const viewportWidth = () => overlay().offsetWidth
const viewportHeight = () => overlay().offsetHeight

/**
 * Nothing in the view is below 16px except the nutrition caption and the
 * disclaimer (HON-932). Walks every text node rather than sampling elements,
 * so a new caption anywhere fails it.
 */
async function assertNoSmallText(dialog: HTMLElement): Promise<void> {
  const nutrition = dialog.querySelector('[data-testid="cook-view-nutrition"]')
  const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement
    if (!element || !node.textContent?.trim() || nutrition?.contains(element)) continue
    const size = px(getComputedStyle(element).fontSize)
    if (size < 16) {
      throw new Error(`"${node.textContent.trim()}" renders at ${size}px, below the 16px floor`)
    }
  }
}

/** The macros line, then the disclaimer directly below it, both visible. */
async function assertDisclaimerUnderMacros(dialog: HTMLElement): Promise<void> {
  const nutrition = within(dialog).getByTestId('cook-view-nutrition')
  const disclaimer = within(nutrition).getByText(/not medical advice/i)
  await expect(disclaimer).toBeVisible()
  await expect(nutrition.lastElementChild).toBe(disclaimer)
  await expect(disclaimer.previousElementSibling).toHaveTextContent(/540 kcal/)
}

/** The dialog was opened with focus on the panel, not on a control in it. */
async function assertFocusOnPanel(dialog: HTMLElement): Promise<void> {
  await waitFor(() => expect(document.activeElement).toBe(dialog))
  await expect(document.activeElement?.getAttribute('role')).not.toBe('checkbox')
  await expect(document.activeElement?.tagName).not.toBe('TEXTAREA')
}

async function loadTips(): Promise<void> {
  await userEvent.click(await body().findByRole('button', { name: 'How to prepare' }))
  await body().findByText(tips.steps![0]!)
}

// ── Devices ────────────────────────────────────────────────────────────────

async function assertPhone(): Promise<void> {
  const dialog = await findDialog()
  // The viewport, edge to edge. Layout metrics, not getBoundingClientRect:
  // the zoom-in transform scales rects while it runs.
  await expect(dialog.offsetWidth).toBe(viewportWidth())
  await expect(dialog.offsetHeight).toBe(viewportHeight())
  await expect(getComputedStyle(dialog).borderTopLeftRadius).toBe('0px')
  const title = within(dialog).getByRole('heading', { level: 2, name: mealFixture.name })
  await expect(getComputedStyle(title).fontSize).toBe('24px')
  // One column: the steps sit under the ingredients, nutrition after them.
  const steps = within(dialog).getByTestId('cook-view-steps')
  const nutrition = within(dialog).getByTestId('cook-view-nutrition')
  await expect(nutrition.getBoundingClientRect().top).toBeGreaterThan(
    steps.getBoundingClientRect().bottom,
  )
  // A 44px+ close, always there.
  const close = within(dialog).getByRole('button', { name: 'Close' })
  await expect(close.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  await assertFocusOnPanel(dialog)
  await assertNoSmallText(dialog)
  await assertDisclaimerUnderMacros(dialog)
}

export const Phone: Story = {
  name: 'Phone (390×844)',
  args: { meal: tintedMeal },
  globals: { viewport: PHONE },
  play: assertPhone,
}

export const PhoneDark: Story = {
  name: 'Phone (390×844, dark)',
  args: { meal: tintedMeal },
  globals: { viewport: PHONE, theme: 'dark' },
  play: assertPhone,
}

/**
 * Two columns that each scroll on their own, inside a panel 24px in from the
 * viewport, with the title at 30px and the steps at 22px.
 */
async function assertColumns(): Promise<void> {
  const dialog = await findDialog()
  await expect(dialog.offsetLeft).toBe(24)
  await expect(dialog.offsetTop).toBe(24)
  await expect(dialog.offsetWidth).toBe(viewportWidth() - 48)
  const title = within(dialog).getByRole('heading', { level: 2, name: mealFixture.name })
  await expect(getComputedStyle(title).fontSize).toBe('30px')

  await loadTips()
  const left = within(dialog).getByTestId('cook-view-left')
  const steps = within(dialog).getByTestId('cook-view-steps')
  // Side by side, the steps on the right.
  await expect(steps.offsetLeft).toBeGreaterThan(left.offsetLeft)
  await expect(steps.offsetTop).toBe(left.offsetTop)
  await expect(getComputedStyle(left).overflowY).toBe('auto')
  await expect(getComputedStyle(steps).overflowY).toBe('auto')
  // Scrolling the steps never moves the ingredients.
  steps.scrollTop = 200
  await expect(left.scrollTop).toBe(0)

  const step = within(steps).getByText(tips.steps![0]!)
  await expect(getComputedStyle(step).fontSize).toBe('22px')
  await assertNoSmallText(dialog)
  await assertDisclaimerUnderMacros(dialog)
}

export const TabletLandscape: Story = {
  name: 'Tablet landscape (1024×768)',
  args: { meal: tintedMeal },
  globals: { viewport: TABLET },
  play: assertColumns,
}

export const TabletLandscapeDark: Story = {
  name: 'Tablet landscape (1024×768, dark)',
  args: { meal: tintedMeal },
  globals: { viewport: TABLET, theme: 'dark' },
  play: assertColumns,
}

export const Laptop: Story = {
  name: 'Laptop (1440×900)',
  args: { meal: tintedMeal },
  globals: { viewport: LAPTOP },
  play: assertColumns,
}

export const LaptopDark: Story = {
  name: 'Laptop (1440×900, dark)',
  args: { meal: tintedMeal },
  globals: { viewport: LAPTOP, theme: 'dark' },
  play: assertColumns,
}

// ── The phone's sticky bar ─────────────────────────────────────────────────

export const StickyTitleBar: Story = {
  name: 'Sticky title bar (phone)',
  args: { meal: tintedMeal },
  globals: { viewport: PHONE },
  parameters: {
    docs: {
      description: {
        story:
          'Over the hero the bar is transparent and holds only the close button. Once the title scrolls under it, the bar takes the tint and shows the meal’s name.',
      },
    },
  },
  play: async () => {
    const dialog = await findDialog()
    const bar = within(dialog).getByTestId('cook-view-bar')
    await expect(bar).not.toHaveAttribute('data-title-hidden')
    await expect(getComputedStyle(bar).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    // Transparent, it lets taps through to the hero.
    await expect(getComputedStyle(bar).pointerEvents).toBe('none')

    // Load the steps so there is a long way to scroll, then go to the end.
    await loadTips()
    const scroller = dialog.querySelector<HTMLElement>('[data-slot="cook-view-scroll"]')!
    scroller.scrollTop = scroller.scrollHeight
    await waitFor(() => expect(bar).toHaveAttribute('data-title-hidden'))
    // After its 200ms colour transition, the bar is the panel's tint.
    await waitFor(() =>
      expect(getComputedStyle(bar).backgroundColor).toBe(getComputedStyle(dialog).backgroundColor),
    )
    // Opaque, it takes taps itself: whatever is scrolled under it is hidden,
    // and a tap there must not reach it (a pantry write, a billed generation).
    await expect(getComputedStyle(bar).pointerEvents).toBe('auto')
    const rect = bar.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + 40, rect.top + rect.height / 2)
    await expect(bar.contains(hit)).toBe(true)

    scroller.scrollTop = 0
    await waitFor(() => expect(bar).not.toHaveAttribute('data-title-hidden'))
  },
}

// ── Image states ───────────────────────────────────────────────────────────

export const WithImage: Story = {
  name: 'Image with a hue',
  args: { meal: tintedMeal },
  play: async () => {
    const dialog = await findDialog()
    const img = await within(dialog).findByRole('img', { name: mealFixture.name })
    await expect(img).toHaveAttribute('alt', mealFixture.name)
    // The whole panel is the meal's surface.
    await expect(dialog).toHaveAttribute('data-meal-surface', '')
    await expect(dialog.style.getPropertyValue('--meal-hue')).toBe('52')
    // Full width of the column at 3:2, capped by `max-h-hero` (45dvh).
    const hero = within(dialog).getByTestId('meal-image-hero')
    const scroller = dialog.querySelector<HTMLElement>('[data-slot="cook-view-scroll"]')!
    await expect(hero.offsetWidth).toBe(scroller.clientWidth)
    await expect(hero.offsetWidth / hero.offsetHeight).toBeGreaterThanOrEqual(1.48)
    await expect(hero.offsetHeight).toBeLessThanOrEqual(Math.ceil(viewportHeight() * 0.45))
    // Decoration, not a control.
    await expect(img).not.toHaveFocus()
  },
}

export const ImageWithoutHue: Story = {
  name: 'Image without a hue',
  args: { meal: { ...tintedMeal, imageHue: null } },
  play: async () => {
    const dialog = await findDialog()
    await within(dialog).findByRole('img', { name: mealFixture.name })
    await expect(dialog).toHaveAttribute('data-meal-surface', 'neutral')
  },
}

// Counts the image POSTs, to prove opening a household meal asks exactly once.
let imageRequests = 0

// A household meal without an image asks for one on open. Without a key the
// route answers 503 — the view must render as if the meal had no image, with
// no box, no tint, no toast and no error copy.
export const WithoutImage: Story = {
  name: 'No image',
  args: {
    meal: { ...mealFixture, id: 'meal-without-image', isCustom: true, imageStatus: 'none' },
  },
  parameters: {
    msw: {
      handlers: {
        image: [
          http.post('/api/meals/:id/image', () => {
            imageRequests += 1
            return HttpResponse.json({ error: 'Meal images are not available' }, { status: 503 })
          }),
        ],
      },
    },
  },
  // Reset before the story renders: the POST fires on open, ahead of `play`.
  beforeEach: () => {
    imageRequests = 0
  },
  play: async () => {
    const dialog = await findDialog()

    await waitFor(() => expect(imageRequests).toBe(1))
    await expect(within(dialog).queryByRole('img')).not.toBeInTheDocument()
    await expect(within(dialog).queryByTestId('meal-image-placeholder')).not.toBeInTheDocument()
    await expect(dialog).not.toHaveAttribute('data-meal-surface')
    await expect(body().queryByRole('alert')).not.toBeInTheDocument()
    // Without a hero, the title clears the close button in the corner.
    const title = within(dialog).getByRole('heading', { level: 2 })
    const close = within(dialog).getByRole('button', { name: 'Close' })
    await expect(title.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      close.getBoundingClientRect().bottom,
    )
  },
}

export const ImageGenerating: Story = {
  name: 'Image generating',
  args: {
    meal: { ...mealFixture, id: 'meal-generating', isCustom: true, imageStatus: 'none' },
  },
  parameters: {
    msw: {
      handlers: {
        image: [
          http.post('/api/meals/:id/image', async () => {
            await delay('infinite')
            return HttpResponse.json({})
          }),
        ],
      },
    },
  },
  play: async () => {
    const dialog = await findDialog()
    // The box shows once the generation has run a second (`useMealImage`).
    await expect(
      await within(dialog).findByTestId('meal-image-placeholder', undefined, { timeout: 3000 }),
    ).toBeVisible()
    await expect(dialog).not.toHaveAttribute('data-meal-surface')
  },
}

// ── Tips states ────────────────────────────────────────────────────────────

export const TipsNotLoaded: Story = {
  name: 'Tips not loaded',
  args: { meal: tintedMeal },
  play: async () => {
    const dialog = await findDialog()
    const steps = within(dialog).getByTestId('cook-view-steps')
    const button = within(steps).getByRole('button', { name: 'How to prepare' })
    await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  },
}

export const TipsLoading: Story = {
  name: 'Tips loading',
  args: { meal: tintedMeal },
  parameters: {
    msw: {
      handlers: {
        tips: [
          http.post('/api/meal-plans/:planId/entries/:entryId/preparation-tips', async () => {
            await delay('infinite')
            return HttpResponse.json({ tips })
          }),
        ],
      },
    },
  },
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'How to prepare' }))
    await expect(await body().findByTestId('preparation-steps-loading')).toBeVisible()
  },
}

export const TipsLoaded: Story = {
  name: 'Tips loaded',
  args: { meal: tintedMeal },
  globals: { viewport: PHONE },
  play: async () => {
    await loadTips()
    const dialog = await findDialog()
    const steps = within(dialog).getByTestId('cook-view-steps')
    // Steps at 20px below `lg`, in the foreground colour, not muted.
    const step = within(steps).getByText(tips.steps![0]!)
    await expect(getComputedStyle(step).fontSize).toBe('20px')
    await expect(getComputedStyle(step).color).toBe(getComputedStyle(dialog).color)
    await expect(within(steps).getByRole('heading', { name: 'Watch out' })).toBeVisible()
    await expect(within(steps).getByRole('heading', { name: 'Tip' })).toBeVisible()
    await expect(
      within(dialog).getByText("You'll need: Sheet pan, Sharp knife, Tongs"),
    ).toBeVisible()
    await assertNoSmallText(dialog)
  },
}

export const TipsError: Story = {
  name: 'Tips error',
  args: { meal: tintedMeal },
  parameters: {
    msw: {
      handlers: {
        tips: [
          http.post('/api/meal-plans/:planId/entries/:entryId/preparation-tips', () =>
            HttpResponse.json(
              { error: 'Rate limit exceeded', code: 'rate_limited' },
              { status: 429 },
            ),
          ),
        ],
      },
    },
  },
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'How to prepare' }))
    await expect(await body().findByText(/reached this hour's limit/i)).toBeVisible()
    const retry = body().getByRole('button', { name: 'Retry' })
    await expect(retry.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  },
}

export const WithPreparationNotes: Story = {
  name: 'With the household’s preparation notes',
  args: {
    meal: {
      ...tintedMeal,
      preparationNotes:
        'Broil the last 2 minutes for crispier skin. Serve with steamed green beans and flaky salt.',
    },
  },
}

export const WithNote: Story = {
  name: 'With a plan note',
  args: {
    meal: tintedMeal,
    note: 'Kids loved this — double the garlic next time.',
    onNoteChange: fn(),
  },
}

export const WithServingOverride: Story = {
  args: {
    servingOverride: 6,
  },
}

export const CompletedServingsReadOnly: Story = {
  name: 'Completed entry',
  args: {
    meal: tintedMeal,
    status: 'completed',
    servingOverride: 6,
  },
  parameters: {
    docs: {
      description: {
        story:
          'A completed entry’s servings are what the pantry was charged for, so the API refuses to change them (HON-652). The count renders as static header text, with no edit control.',
      },
    },
  },
  play: async () => {
    const dialog = await findDialog()
    await expect(within(dialog).getByText('Ingredients (serves 6)')).toBeInTheDocument()
    await expect(within(dialog).queryByRole('button', { name: /serves 6/i })).toBeNull()
  },
}

export const Estonian: Story = {
  name: 'Estonian',
  args: { meal: tintedMeal },
  globals: { locale: 'et', viewport: PHONE },
  play: async () => {
    await loadTipsEt()
    const dialog = await findDialog()
    await expect(within(dialog).getByRole('heading', { name: 'Koostisosad' })).toBeVisible()
    await expect(within(dialog).getByRole('heading', { name: 'Tähelepanu' })).toBeVisible()
    await expect(
      within(dialog).getByText('Vaja läheb: Sheet pan, Sharp knife, Tongs'),
    ).toBeVisible()
  },
}

async function loadTipsEt(): Promise<void> {
  await userEvent.click(await body().findByRole('button', { name: 'Kuidas valmistada' }))
  await body().findByText(tips.steps![0]!)
}

// ── Callback contracts ─────────────────────────────────────────────────────
// Radix Dialog portals outside `canvasElement`, so queries go through
// `document.body`.

export const EscapeClosesDialog: Story = {
  play: async ({ args }) => {
    await findDialog()
    await userEvent.keyboard('{Escape}')
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

export const ChangeServingInvokesCallback: Story = {
  args: {
    servingOverride: 6,
  },
  play: async ({ args }) => {
    const servingButton = await body().findByRole('button', { name: /serves 6/i })
    await userEvent.click(servingButton)

    const input = await body().findByLabelText('Number of servings')
    await userEvent.clear(input)
    await userEvent.type(input, '5')
    await userEvent.keyboard('{Enter}')

    // handleServingsChange awaits the PATCH before firing onServingOverrideChange
    await waitFor(() => expect(args.onServingOverrideChange).toHaveBeenCalledWith(5))
  },
}

// Counts the tips POSTs the story's msw handler serves, so the second click
// can be proven to be a real re-fetch rather than a replay of cached state.
let tipsRequests = 0

// The serving count is an input to the cached preparation tips, so the PATCH
// nulls them server-side (HON-681). This component is rendered unconditionally
// by `MealCard`, so it never unmounts — without dropping the hook's `tips` on
// the same success branch, the view keeps rendering the old count's pan sizes
// through a close and reopen, and `handleHowToPrepare` short-circuits on the
// stale object rather than re-fetching.
export const ChangeServingDropsCachedTips: Story = {
  args: {
    servingOverride: 6,
  },
  parameters: {
    msw: {
      handlers: {
        // Varies per call, so the second click can be told apart from a replay
        // of the first one's object.
        tips: [
          http.post('/api/meal-plans/:planId/entries/:entryId/preparation-tips', () => {
            tipsRequests += 1
            return HttpResponse.json({
              tips: {
                equipment: [
                  tipsRequests === 1
                    ? 'A 28cm skillet for six portions'
                    : 'A 20cm skillet for three portions',
                ],
                steps: ['Sear the chicken in two batches'],
                pitfalls: ['Crowding the pan steams the skin'],
              },
            })
          }),
        ],
      },
    },
  },
  play: async () => {
    tipsRequests = 0

    // Generate tips for the stored count of 6.
    await userEvent.click(await body().findByRole('button', { name: /how to prepare/i }))
    await body().findByText(/28cm skillet/i)

    // Re-plan the same entry at 3 servings.
    await userEvent.click(await body().findByRole('button', { name: /serves 6/i }))
    const input = await body().findByLabelText('Number of servings')
    await userEvent.clear(input)
    await userEvent.type(input, '3')
    await userEvent.keyboard('{Enter}')

    // The six-portion tips are off screen and the prompt is back.
    await waitFor(() => expect(body().queryByText(/28cm skillet/i)).not.toBeInTheDocument())

    // The assertion that pins `setTips(null)`: ask again. Collapsing the view
    // alone would satisfy everything above — `MealDetail` renders the prompt
    // off `isTipsExpanded` and never looks at `tips` — but with the stale
    // object still in the hook, `handleHowToPrepare` just re-expands it and
    // never re-POSTs. A second request, and three-portion copy, is the proof.
    await userEvent.click(await body().findByRole('button', { name: /how to prepare/i }))
    await body().findByText(/20cm skillet/i)
    await expect(tipsRequests).toBe(2)
  },
}

export const EditNoteInvokesCallback: Story = {
  args: {
    note: 'Kids loved this — double the garlic next time.',
    onNoteChange: fn(),
  },
  play: async ({ args }) => {
    const editButton = await body().findByRole('button', { name: /kids loved this/i })
    await userEvent.click(editButton)

    const textarea = await body().findByLabelText('Meal note')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Add extra lemon zest.')
    await userEvent.keyboard('{Enter}')

    // NoteEditor.handleSave awaits the PATCH before firing onNoteChange
    await waitFor(() => expect(args.onNoteChange).toHaveBeenCalledWith('Add extra lemon zest.'))
  },
}

// Interaction-a11y story — asserts focus trap on open, tab containment, Escape
// handling, and close-sequence completion. See `src/stories/a11y-helpers.ts`.
// Wraps the modal in a local trigger-button render so it can be opened via
// keyboard like a real callsite. With a note on the entry, so the check that
// focus lands on the panel and not on the note editor or a checkbox means
// something.
export const A11yInteractionPatterns: Story = {
  args: {
    open: false,
    note: 'Kids loved this — double the garlic next time.',
    onNoteChange: fn(),
  },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div>
        <button type="button" data-testid="a11y-trigger" onClick={() => setOpen(true)}>
          Open modal
        </button>
        <MealDetailModal
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
    await assertFocusOnPanel(await findDialog())
    await assertTabStaysInDialog()

    await pressEscape()
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
    await awaitDialogClosed()
  },
}

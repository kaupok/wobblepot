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
const box = (el: Element) => el.getBoundingClientRect()

/** Whether two boxes share any area: touching edges do not count. */
function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** The "Steps" heading sits clear of the close button in the panel's corner. */
async function assertStepsClearOfClose(dialog: HTMLElement): Promise<void> {
  const heading = within(within(dialog).getByTestId('cook-view-steps')).getByRole('heading', {
    name: 'Steps',
  })
  const close = within(dialog).getByRole('button', { name: 'Close' })
  // The text, not the heading: a block spans the column's full width.
  const text = document.createRange()
  text.selectNodeContents(heading)
  await expect(overlaps(text.getBoundingClientRect(), box(close))).toBe(false)
}

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
  // One column: the hero first, although it sits in the steps column in the
  // DOM (HON-966), then nutrition under the ingredients, then the steps (HON-965).
  const hero = within(dialog).getByTestId('meal-image-hero')
  await expect(box(hero).bottom).toBeLessThanOrEqual(box(title).top)
  const steps = within(dialog).getByTestId('cook-view-steps-body')
  const nutrition = within(dialog).getByTestId('cook-view-nutrition')
  await expect(box(nutrition).bottom).toBeLessThanOrEqual(box(steps).top)
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
  // The title heads the left column; the hero heads the steps column, then
  // "You'll need", then "Steps" (HON-966).
  steps.scrollTop = 0
  await expect(box(title).top).toBeLessThan(
    box(within(left).getByRole('heading', { name: /^Ingredients/ })).top,
  )
  const hero = within(steps).getByTestId('meal-image-hero')
  await expect(box(hero).top).toBe(box(steps).top)
  await expect(hero.offsetWidth).toBe(steps.clientWidth)
  const equipment = within(steps).getByRole('heading', { name: "You'll need" })
  const stepsHeading = within(steps).getByRole('heading', { name: 'Steps' })
  await expect(box(hero).bottom).toBeLessThanOrEqual(box(equipment).top)
  await expect(box(equipment).bottom).toBeLessThanOrEqual(box(stepsHeading).top)
  await assertStepsClearOfClose(dialog)
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

/**
 * Without a hero, the "Steps" heading starts on the meal name's line, and the
 * close button in the corner stays clear of it (HON-951).
 */
async function assertStepsAlignedWithTitle(): Promise<void> {
  const dialog = await findDialog()
  await expect(within(dialog).queryByTestId('meal-image-hero')).not.toBeInTheDocument()
  const title = within(dialog).getByRole('heading', { level: 2, name: mealFixture.name })
  const steps = within(dialog).getByTestId('cook-view-steps')
  const heading = within(steps).getByRole('heading', { name: 'Steps' })
  await expect(Math.abs(box(heading).top - box(title).top)).toBeLessThanOrEqual(4)
  await assertStepsClearOfClose(dialog)
}

export const WithoutImageTabletLandscape: Story = {
  name: 'No image, tablet landscape (1024×768)',
  globals: { viewport: TABLET },
  play: assertStepsAlignedWithTitle,
}

export const WithoutImageLaptop: Story = {
  name: 'No image, laptop (1440×900)',
  globals: { viewport: LAPTOP },
  play: assertStepsAlignedWithTitle,
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
    await waitFor(
      () => expect(within(dialog).getByTestId('meal-image-placeholder')).toBeVisible(),
      { timeout: 3000 },
    )
    await expect(dialog).not.toHaveAttribute('data-meal-surface')
  },
}

// ── Tips states ────────────────────────────────────────────────────────────

export const TipsNotLoaded: Story = {
  name: 'Tips not loaded',
  args: { meal: tintedMeal },
  parameters: {
    docs: {
      description: {
        story:
          'An entry nobody is about to cook — completed, skipped, past or read-only (`generateOnOpen` off) — asks for its steps with "How to prepare" rather than generating them on open (HON-933).',
      },
    },
  },
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
    // Past the dialog's fade-in first: the skeleton renders on the click, and
    // `toBeVisible` fails on it while the dialog's opacity is still 0 (HON-1006).
    const dialog = await findDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'How to prepare' }))
    await waitFor(() =>
      expect(within(dialog).getByTestId('preparation-steps-loading')).toBeVisible(),
    )
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
    const equipment = within(dialog).getByRole('list', { name: "You'll need" })
    await expect(equipment).toBeVisible()
    await expect(within(equipment).getAllByRole('listitem')).toHaveLength(3)
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
    // The 429 comes back at once, so without this the error can render in the
    // first frame of the dialog's fade-in (HON-1006).
    const dialog = await findDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'How to prepare' }))
    await waitFor(() =>
      expect(within(dialog).getByText(/reached this hour's limit/i)).toBeVisible(),
    )
    const retry = within(dialog).getByRole('button', { name: 'Retry' })
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
    await expect(within(dialog).getByRole('list', { name: 'Vaja läheb' })).toBeVisible()
  },
}

async function loadTipsEt(): Promise<void> {
  await userEvent.click(await body().findByRole('button', { name: 'Kuidas valmistada' }))
  await body().findByText(tips.steps![0]!)
}

// ── Cooking: steps on open, progress, Done cooking (HON-933) ───────────────

// Counts the tips POSTs, to prove how many generations an open costs.
let openTipsRequests = 0
const countedTipsHandler = http.post(
  '/api/meal-plans/:planId/entries/:entryId/preparation-tips',
  () => {
    openTipsRequests += 1
    return HttpResponse.json({ tips })
  },
)

/** A planned entry, as `MealCard` opens one for today. */
const plannedArgs = {
  meal: tintedMeal,
  status: 'planned' as const,
  generateOnOpen: true,
  onDoneCooking: fn(),
}

const stepButton = (index: number) => body().getByRole('button', { name: tips.steps![index]! })

export const StepsLoadOnOpen: Story = {
  name: 'Planned: steps load on open',
  args: plannedArgs,
  parameters: { msw: { handlers: { tips: [countedTipsHandler] } } },
  beforeEach: () => {
    openTipsRequests = 0
  },
  play: async () => {
    const dialog = await findDialog()
    // No "How to prepare": the steps arrive by themselves, from one POST.
    await within(dialog).findByText(tips.steps![0]!)
    await expect(within(dialog).queryByRole('button', { name: 'How to prepare' })).toBeNull()
    await expect(openTipsRequests).toBe(1)
  },
}

export const StepsCached: Story = {
  name: 'Planned: cached steps, no request',
  args: { ...plannedArgs, initialTips: tips },
  parameters: { msw: { handlers: { tips: [countedTipsHandler] } } },
  beforeEach: () => {
    openTipsRequests = 0
  },
  play: async () => {
    const dialog = await findDialog()
    await expect(within(dialog).getByText(tips.steps![0]!)).toBeVisible()
    await expect(within(dialog).queryByTestId('preparation-steps-loading')).toBeNull()
    await expect(openTipsRequests).toBe(0)
  },
}

export const StepsGenerating: Story = {
  name: 'Planned: writing the steps',
  args: plannedArgs,
  globals: { viewport: PHONE },
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
    const dialog = await findDialog()
    await expect(within(dialog).getByTestId('preparation-steps-loading')).toBeVisible()
    await expect(within(dialog).getByText('Writing the steps…')).toBeVisible()
    await expect(within(dialog).queryByRole('button', { name: 'How to prepare' })).toBeNull()
    await assertNoSmallText(dialog)
  },
}

export const TapStepToMarkDone: Story = {
  name: 'Planned: tap a step to mark it done',
  args: { ...plannedArgs, initialTips: tips },
  globals: { viewport: PHONE },
  play: async () => {
    await findDialog()
    // Nothing done yet: the first step is the current one.
    await expect(stepButton(0)).toHaveAttribute('aria-pressed', 'false')
    await expect(stepButton(0)).toHaveAttribute('data-current')
    // The whole row is a knuckle-sized target.
    await expect(stepButton(0).getBoundingClientRect().height).toBeGreaterThanOrEqual(44)

    await userEvent.click(stepButton(0))
    await expect(stepButton(0)).toHaveAttribute('aria-pressed', 'true')
    await expect(stepButton(0)).not.toHaveAttribute('data-current')
    await expect(stepButton(1)).toHaveAttribute('data-current')
    // Done reads muted, never struck through.
    const text = within(stepButton(0)).getByText(tips.steps![0]!)
    await expect(text).toHaveClass('text-muted-foreground')
    await expect(getComputedStyle(text).textDecorationLine).toBe('none')

    // Tapping it again un-marks it, and it is current again.
    await userEvent.click(stepButton(0))
    await expect(stepButton(0)).toHaveAttribute('aria-pressed', 'false')
    await expect(stepButton(0)).toHaveAttribute('data-current')

    // Every step done: nothing is highlighted.
    for (let i = 0; i < tips.steps!.length; i++) await userEvent.click(stepButton(i))
    await expect(body().getByRole('dialog').querySelector('[data-current]')).toBeNull()
  },
}

export const TapStepToMarkDoneDark: Story = {
  name: 'Planned: step progress (dark)',
  args: { ...plannedArgs, initialTips: tips },
  globals: { viewport: PHONE, theme: 'dark' },
  play: async () => {
    await findDialog()
    await userEvent.click(stepButton(0))
    await expect(stepButton(1)).toHaveAttribute('data-current')
  },
}

export const KeyboardTogglesStep: Story = {
  name: 'Planned: keyboard toggles a step',
  args: { ...plannedArgs, initialTips: tips },
  play: async () => {
    await findDialog()
    stepButton(1).focus()
    await userEvent.keyboard(' ')
    await expect(stepButton(1)).toHaveAttribute('aria-pressed', 'true')
    await userEvent.keyboard('{Enter}')
    await expect(stepButton(1)).toHaveAttribute('aria-pressed', 'false')
    // Tab moves on to the step's Ask button (HON-969), then the next step.
    await userEvent.tab()
    await expect(body().getByRole('button', { name: 'Ask about step 2' })).toHaveFocus()
    await userEvent.tab()
    await expect(stepButton(2)).toHaveFocus()
  },
}

/**
 * Ask about a step (HON-969): the chip sends at once, the answer shows under
 * the step below the question asked, and Edit puts the question back in the
 * field (HON-976). Close puts focus back on that step's Ask button, and the
 * question is gone on reopening or on another step's panel.
 */
export const AskAboutStep: Story = {
  name: 'Planned: ask about a step',
  args: { ...plannedArgs, initialTips: tips },
  parameters: {
    msw: {
      handlers: {
        cookQuestion: [
          http.post('/api/meal-plans/:planId/entries/:entryId/cook-question', () =>
            HttpResponse.text('Use the Greek yoghurt you have, stirred in off the heat.'),
          ),
        ],
      },
    },
  },
  play: async () => {
    await findDialog()
    const ask = body().getByRole('button', { name: 'Ask about step 2' })
    await expect(ask.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    await userEvent.click(ask)
    const panelFor = (n: number) => body().getByRole('group', { name: `Ask about step ${n}` })
    const chip = (n: number) =>
      within(panelFor(n)).getByRole('button', { name: 'What can I substitute here?' })
    const answer = 'Use the Greek yoghurt you have, stirred in off the heat.'
    await userEvent.click(chip(2))
    const line = await within(panelFor(2)).findByText('You asked: What can I substitute here?')
    await waitFor(() => expect(within(panelFor(2)).getByText(answer)).toBeVisible())
    // The question stays above the answer once it arrives.
    await expect(line).toBeVisible()
    await expect(
      line.compareDocumentPosition(within(panelFor(2)).getByText(answer)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    await userEvent.click(within(panelFor(2)).getByRole('button', { name: 'Edit' }))
    const field = within(panelFor(2)).getByRole('textbox', { name: 'Your question' })
    await expect(field).toHaveValue('What can I substitute here?')
    await expect(field).toHaveFocus()

    await userEvent.click(within(panelFor(2)).getByRole('button', { name: 'Close' }))
    await expect(body().queryByRole('group', { name: 'Ask about step 2' })).toBeNull()
    await expect(ask).toHaveFocus()

    // Reopened, the panel starts empty.
    await userEvent.click(ask)
    await expect(within(panelFor(2)).queryByText(/^You asked:/)).toBeNull()

    // Another step's panel shows no question until one is sent there.
    await userEvent.click(chip(2))
    await within(panelFor(2)).findByText(answer)
    await userEvent.click(body().getByRole('button', { name: 'Ask about step 3' }))
    await expect(within(panelFor(3)).queryByText(/^You asked:/)).toBeNull()
  },
}

/**
 * Ticking the step whose panel is open closes the panel (HON-982): the cook
 * has moved on. Focus stays on the toggle that was pressed.
 */
export const AskClosesWhenStepDone: Story = {
  name: 'Planned: ticking the step closes its Ask panel',
  args: { ...plannedArgs, initialTips: tips },
  play: async () => {
    await findDialog()
    const ask = body().getByRole('button', { name: 'Ask about step 2' })
    await userEvent.click(ask)
    await expect(body().getByRole('group', { name: 'Ask about step 2' })).toBeVisible()
    await expect(ask).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(stepButton(1))
    await expect(stepButton(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(body().queryByRole('group', { name: 'Ask about step 2' })).toBeNull()
    await expect(ask).toHaveAttribute('aria-expanded', 'false')
    await expect(document.activeElement).toBe(stepButton(1))

    // Un-ticking it reopens nothing.
    await userEvent.click(stepButton(1))
    await expect(body().queryByRole('group', { name: 'Ask about step 2' })).toBeNull()
  },
}

/** Ticking a different step leaves the open panel as it is (HON-982). */
export const AskStaysWhenOtherStepDone: Story = {
  name: 'Planned: ticking another step keeps the Ask panel',
  args: { ...plannedArgs, initialTips: tips },
  play: async () => {
    await findDialog()
    const ask = body().getByRole('button', { name: 'Ask about step 2' })
    await userEvent.click(ask)

    await userEvent.click(stepButton(2))
    await expect(stepButton(2)).toHaveAttribute('aria-pressed', 'true')
    await expect(body().getByRole('group', { name: 'Ask about step 2' })).toBeVisible()
    await expect(ask).toHaveAttribute('aria-expanded', 'true')
  },
}

// ── Ask: the answer stays in view (HON-977) ──────────────────────────────

/** Twelve long steps, so the last ones sit far below the fold. */
const longTips: StructuredTips = {
  ...tips,
  steps: Array.from(
    { length: 12 },
    (_, i) =>
      `Step ${i + 1}: stir the pan over a medium heat, scraping the bottom so nothing catches, until the sauce coats the back of a spoon.`,
  ),
}

const longAnswer =
  'Skip the resting time and slice the chicken straight away; it will be a little less juicy but still good. ' +
  'Put the potatoes on the top rack at 230°C so they crisp in 25 minutes instead of 35. ' +
  'Squeeze the lemon over everything while it is hot. ' +
  'If the sauce is thin, boil it hard for two minutes while you slice.'

const longAnswerHandler = http.post(
  '/api/meal-plans/:planId/entries/:entryId/cook-question',
  async () => {
    await delay(200)
    return HttpResponse.text(longAnswer)
  },
)

/** Whether `inner` lies wholly inside `outer`'s box, give or take a pixel of rounding. */
function isInside(inner: Element, outer: Element): boolean {
  const a = box(inner)
  const b = box(outer)
  return a.top >= b.top - 1 && a.bottom <= b.bottom + 1
}

const resultOf = (panel: HTMLElement) =>
  panel.querySelector<HTMLElement>('[data-slot="cook-question-result"]')!

/**
 * The last step's Ask button sits on the bottom edge of the scroll region,
 * as a cook reaches it scrolling down. Opening it brings the chips and the
 * field into view. A chip's long answer arrives, and the answer with Close
 * scrolls into view, while focus stays on the chip.
 */
async function assertAnswerKeptInView(scroller: HTMLElement): Promise<void> {
  const last = longTips.steps!.length
  const ask = body().getByRole('button', { name: `Ask about step ${last}` })
  ask.scrollIntoView({ block: 'end' })
  await userEvent.click(ask)

  const panel = body().getByRole('group', { name: `Ask about step ${last}` })
  const field = within(panel).getByRole('textbox', { name: 'Your question' })
  await waitFor(() => expect(isInside(field, scroller)).toBe(true))

  const chip = within(panel).getByRole('button', { name: "I'm short on time" })
  await userEvent.click(chip)
  await within(panel).findByText(longAnswer)
  const close = within(panel).getByRole('button', { name: 'Close' })
  await expect(resultOf(panel)).toContainElement(close)
  await waitFor(() => expect(isInside(resultOf(panel), scroller)).toBe(true))
  // The answer arriving moved nothing but the scroll.
  await expect(chip).toHaveFocus()
}

/**
 * From `lg` the steps column scrolls on its own: the panel and then the answer
 * scroll into view inside it.
 */
export const AskKeepsAnswerInView: Story = {
  name: 'Planned: ask keeps the answer in view',
  args: { ...plannedArgs, initialTips: longTips },
  globals: { viewport: LAPTOP },
  parameters: { msw: { handlers: { cookQuestion: [longAnswerHandler] } } },
  play: async () => {
    const dialog = await findDialog()
    await assertAnswerKeptInView(within(dialog).getByTestId('cook-view-steps'))
  },
}

/**
 * Below `lg` the dialog is one column that scrolls as a whole. Reduced motion
 * on: the scroll snaps rather than glides.
 */
export const AskKeepsAnswerInViewPhone: Story = {
  name: 'Planned: ask keeps the answer in view (phone, reduced motion)',
  args: { ...plannedArgs, initialTips: longTips },
  globals: { viewport: PHONE, reducedMotion: 'on' },
  parameters: { msw: { handlers: { cookQuestion: [longAnswerHandler] } } },
  play: async () => {
    const dialog = await findDialog()
    await assertAnswerKeptInView(
      dialog.querySelector<HTMLElement>('[data-slot="cook-view-scroll"]')!,
    )
  },
}

/**
 * A panel that opens, and answers, in full view does not move the steps.
 * Reduced motion on, so any scroll would land at once and fail the check.
 */
export const AskPanelInViewDoesNotMove: Story = {
  name: 'Planned: ask in view does not scroll',
  args: { ...plannedArgs, initialTips: tips },
  globals: { viewport: LAPTOP, reducedMotion: 'on' },
  parameters: {
    msw: {
      handlers: {
        cookQuestion: [
          http.post('/api/meal-plans/:planId/entries/:entryId/cook-question', () =>
            HttpResponse.text('About 20 minutes more.'),
          ),
        ],
      },
    },
  },
  play: async () => {
    const dialog = await findDialog()
    const scroller = within(dialog).getByTestId('cook-view-steps')
    const ask = within(dialog).getByRole('button', { name: 'Ask about step 2' })
    ask.scrollIntoView({ block: 'center' })
    const scrollTop = scroller.scrollTop

    await userEvent.click(ask)
    const panel = body().getByRole('group', { name: 'Ask about step 2' })
    await expect(isInside(panel, scroller)).toBe(true)
    await expect(scroller.scrollTop).toBe(scrollTop)

    await userEvent.click(within(panel).getByRole('button', { name: "I'm short on time" }))
    await within(panel).findByText('About 20 minutes more.')
    // The arrival's effect runs before the next frame; give it two.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await expect(isInside(resultOf(panel), scroller)).toBe(true)
    await expect(scroller.scrollTop).toBe(scrollTop)
  },
}

// ── Ask: the old answer holds its place (HON-978) ────────────────────────

/**
 * "I'm short on time" answers at once with the long answer; any other question
 * takes a second and a half, so the play can measure the panel while it waits.
 */
const secondAnswerWaitsHandler = http.post(
  '/api/meal-plans/:planId/entries/:entryId/cook-question',
  async ({ request }) => {
    const { question } = (await request.json()) as { question: string }
    if (question === "I'm short on time") return HttpResponse.text(longAnswer)
    await delay(1500)
    return HttpResponse.text('About 20 minutes more.')
  },
)

/**
 * A second question keeps the first answer on screen, muted, above
 * "Thinking…", so the status block does not shrink and the steps below the
 * panel stay where they are until the new answer replaces it in place.
 */
export const AskKeepsOldAnswerWhilePending: Story = {
  name: 'Planned: ask keeps the old answer while the next one loads',
  args: { ...plannedArgs, initialTips: tips },
  globals: { viewport: LAPTOP, reducedMotion: 'on' },
  parameters: { msw: { handlers: { cookQuestion: [secondAnswerWaitsHandler] } } },
  play: async () => {
    const dialog = await findDialog()
    const scroller = within(dialog).getByTestId('cook-view-steps')
    const ask = within(dialog).getByRole('button', { name: 'Ask about step 2' })
    ask.scrollIntoView({ block: 'start' })
    await userEvent.click(ask)
    const panel = body().getByRole('group', { name: 'Ask about step 2' })
    const status = within(panel).getByRole('status')
    const nextStep = within(dialog).getByRole('button', { name: tips.steps![2]! })
    // Where the next step sits in the scroll region's content, so a scroll
    // does not read as the step moving.
    const offsetOf = (el: Element) => box(el).top - box(scroller).top + scroller.scrollTop

    await userEvent.click(within(panel).getByRole('button', { name: "I'm short on time" }))
    await within(panel).findByText(longAnswer)
    const answeredHeight = box(status).height
    const answeredOffset = offsetOf(nextStep)

    await userEvent.click(within(panel).getByRole('button', { name: "How do I know it's done?" }))
    await within(status).findByText('Thinking…')
    // The old answer stays, muted, under its own question.
    await expect(within(status).getByText(longAnswer)).toHaveClass('text-muted-foreground')
    await expect(within(panel).getByText("You asked: I'm short on time")).toBeVisible()
    await expect(box(status).height).toBeGreaterThanOrEqual(answeredHeight)
    await expect(offsetOf(nextStep)).toBe(answeredOffset)

    // The new answer takes the old one's place.
    await within(status).findByText('About 20 minutes more.', {}, { timeout: 4000 })
    await expect(within(status).queryByText(longAnswer)).toBeNull()
    await expect(within(status).queryByText('Thinking…')).toBeNull()
    await expect(within(panel).getByText("You asked: How do I know it's done?")).toBeVisible()
  },
}

// ── Ask: the answer streams in (HON-979) ─────────────────────────────────

const streamedChunks = [
  'Cut into the thickest piece. ',
  'The juices run clear ',
  'when it is done.',
]

/** The answer in three chunks, 400ms apart, as the route streams it. */
const streamedAnswerHandler = http.post(
  '/api/meal-plans/:planId/entries/:entryId/cook-question',
  () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const chunk of streamedChunks) {
          await delay(400)
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    })
    return new HttpResponse(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  },
)

/**
 * The first words show before the rest is written, and the answer grows in
 * place. Send and the chips stay disabled until the stream closes, so a second
 * tap cannot bill a second call.
 */
export const AskStreamsAnswer: Story = {
  name: 'Planned: ask streams the answer in',
  args: { ...plannedArgs, initialTips: tips },
  parameters: { msw: { handlers: { cookQuestion: [streamedAnswerHandler] } } },
  play: async () => {
    await findDialog()
    await userEvent.click(body().getByRole('button', { name: 'Ask about step 2' }))
    const panel = body().getByRole('group', { name: 'Ask about step 2' })
    const status = within(panel).getByRole('status')
    const send = within(panel).getByRole('button', { name: 'Send' })

    await userEvent.click(within(panel).getByRole('button', { name: "How do I know it's done?" }))
    await within(status).findByText('Cut into the thickest piece.')
    await expect(status).not.toHaveTextContent('Thinking…')
    await expect(status).toHaveAttribute('aria-busy', 'true')
    await expect(send).toHaveAttribute('aria-disabled', 'true')

    await within(status).findByText('Cut into the thickest piece. The juices run clear')
    await expect(send).toHaveAttribute('aria-disabled', 'true')

    const full = streamedChunks.join('').trim()
    await within(status).findByText(full, {}, { timeout: 4000 })
    await waitFor(() => expect(send).toHaveAttribute('aria-disabled', 'false'))
    await expect(status).toHaveAttribute('aria-busy', 'false')
  },
}

/** The bodies the cook-question route received, newest last (HON-983). */
const cookQuestionBodies: unknown[] = []

/**
 * Ask about an item in "You'll need" (HON-983): opening its panel closes an
 * open step panel, and a chip sends the item as the subject, with the
 * equipment and the steps on screen.
 */
export const AskAboutEquipment: Story = {
  name: 'Planned: ask about an item in You’ll need',
  args: { ...plannedArgs, initialTips: tips },
  parameters: {
    msw: {
      handlers: {
        cookQuestion: [
          http.post(
            '/api/meal-plans/:planId/entries/:entryId/cook-question',
            async ({ request }) => {
              cookQuestionBodies.push(await request.json())
              return HttpResponse.text(
                'A heavy chopping board and a serrated bread knife will do for step 2.',
              )
            },
          ),
        ],
      },
    },
  },
  play: async () => {
    cookQuestionBodies.length = 0
    await findDialog()
    const list = body().getByRole('list', { name: "You'll need" })
    for (const item of tips.equipment!) {
      await expect(within(list).getByRole('button', { name: `Ask about ${item}` })).toBeVisible()
    }

    await userEvent.click(body().getByRole('button', { name: 'Ask about step 2' }))
    await expect(body().getByRole('group', { name: 'Ask about step 2' })).toBeVisible()

    const knife = within(list).getByRole('button', { name: 'Ask about Sharp knife' })
    await userEvent.click(knife)
    await expect(body().queryByRole('group', { name: 'Ask about step 2' })).toBeNull()
    await expect(body().getByRole('button', { name: 'Ask about step 2' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    const panel = body().getByRole('group', { name: 'Ask about Sharp knife' })
    await userEvent.click(within(panel).getByRole('button', { name: 'What can I use instead?' }))
    await within(panel).findByText(
      'A heavy chopping board and a serrated bread knife will do for step 2.',
    )
    await expect(cookQuestionBodies).toHaveLength(1)
    await expect(cookQuestionBodies[0]).toEqual({
      subject: { kind: 'equipment', index: 1 },
      steps: tips.steps,
      equipment: tips.equipment,
      question: 'What can I use instead?',
    })

    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    await expect(knife).toHaveFocus()
  },
}

/** A completed entry gets no Ask buttons: nobody is cooking it. */
export const CompletedHasNoAsk: Story = {
  name: 'Completed: no Ask buttons',
  args: { meal: tintedMeal, status: 'completed', initialTips: tips },
  play: async () => {
    await findDialog()
    await userEvent.click(await body().findByRole('button', { name: 'How to prepare' }))
    await waitFor(() => expect(body().getByRole('button', { name: tips.steps![0]! })).toBeVisible())
    await expect(body().queryByRole('button', { name: /^Ask about step/ })).toBeNull()
  },
}

export const DoneCooking: Story = {
  name: 'Planned: Done cooking',
  args: { ...plannedArgs, initialTips: tips },
  render: (args) => {
    const [open, setOpen] = useState(args.open)
    return (
      <MealDetailModal
        {...args}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          args.onOpenChange(next)
        }}
      />
    )
  },
  play: async ({ args }) => {
    const dialog = await findDialog()
    const done = within(dialog).getByRole('button', { name: 'Done cooking' })
    await expect(done.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    // After the steps, Watch out and Tip.
    const tip = within(dialog).getByText(tips.tip!)
    await expect(done.getBoundingClientRect().top).toBeGreaterThan(tip.getBoundingClientRect().top)

    await userEvent.click(done)
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
    await awaitDialogClosed()
    // Called once the view is gone, so the deduction never stacks on it.
    await waitFor(() => expect(args.onDoneCooking).toHaveBeenCalledTimes(1))
  },
}

/**
 * On a phone the view ends on "Done cooking": nutrition and its disclaimer sit
 * under the ingredients, and nothing follows the button, either in the DOM a
 * screen reader walks or on screen (HON-965).
 */
export const DoneCookingPhone: Story = {
  name: 'Planned: Done cooking ends the view (phone)',
  args: { ...plannedArgs, initialTips: tips },
  globals: { viewport: PHONE },
  play: async () => {
    const dialog = await findDialog()
    const done = within(dialog).getByRole('button', { name: 'Done cooking' })
    const nutrition = within(dialog).getByTestId('cook-view-nutrition')
    const steps = within(dialog).getByTestId('cook-view-steps-body')
    await expect(box(nutrition).bottom).toBeLessThanOrEqual(box(steps).top)
    // "You'll need" sits directly above "Steps" (HON-966).
    const equipment = within(steps).getByRole('heading', { name: "You'll need" })
    const stepsHeading = within(steps).getByRole('heading', { name: 'Steps' })
    await expect(equipment.parentElement?.nextElementSibling).toBe(stepsHeading)
    await expect(box(equipment).bottom).toBeLessThanOrEqual(box(stepsHeading).top)
    const scroll = dialog.querySelector<HTMLElement>('[data-slot="cook-view-scroll"]')!
    const doneBottom = done.getBoundingClientRect().bottom
    const walker = document.createTreeWalker(scroll, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || done.contains(node)) continue
      const text = node.textContent.trim()
      if (done.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
        throw new Error(`"${text}" follows Done cooking in the DOM`)
      }
      const range = document.createRange()
      range.selectNodeContents(node)
      if (range.getBoundingClientRect().bottom > doneBottom) {
        throw new Error(`"${text}" renders below Done cooking`)
      }
    }
  },
}

export const CompletedNoDoneCooking: Story = {
  name: 'Completed: no Done cooking',
  args: { meal: tintedMeal, status: 'completed' },
  parameters: { msw: { handlers: { tips: [countedTipsHandler] } } },
  beforeEach: () => {
    openTipsRequests = 0
  },
  play: async () => {
    const dialog = await findDialog()
    await expect(within(dialog).getByRole('button', { name: 'How to prepare' })).toBeVisible()
    await expect(within(dialog).queryByRole('button', { name: 'Done cooking' })).toBeNull()
    await expect(openTipsRequests).toBe(0)
  },
}

export const DoneCookingEstonian: Story = {
  name: 'Planned: Estonian',
  args: plannedArgs,
  globals: { locale: 'et', viewport: PHONE },
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
    const dialog = await findDialog()
    await expect(within(dialog).getByText('Koostan juhiseid…')).toBeVisible()
    await expect(within(dialog).getByRole('button', { name: 'Söök on valmis' })).toBeVisible()
  },
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

// Escape in the note or the "Serves" field cancels that field and leaves the
// view open; the next Escape, from the panel, closes it (HON-949).
export const EscapeInFieldKeepsViewOpen: Story = {
  name: 'Escape in a field keeps the view open',
  args: {
    onNoteChange: fn(),
  },
  play: async ({ args }) => {
    const dialog = await findDialog()

    const more = within(dialog).getByRole('button', { name: `More actions: ${mealFixture.name}` })
    await userEvent.click(more)
    await userEvent.click(await body().findByRole('menuitem', { name: 'Add note' }))
    const note = await within(dialog).findByRole('textbox', { name: 'Meal note' })
    await waitFor(() => expect(note).toHaveFocus())
    // The closing menu keeps its Escape layer through its 200ms exit
    // animation; no hand is that fast, so wait it out.
    await waitFor(() => expect(body().queryByRole('menu')).not.toBeInTheDocument())
    await userEvent.type(note, 'Half-typed')
    await pressEscape()
    await waitFor(() => expect(note).not.toBeInTheDocument())
    await waitFor(() => expect(more).toHaveFocus())

    await userEvent.click(within(dialog).getByRole('button', { name: /serves 4/i }))
    const servings = await within(dialog).findByRole('textbox', { name: 'Number of servings' })
    await waitFor(() => expect(servings).toHaveFocus())
    await pressEscape()
    await waitFor(() => expect(servings).not.toBeInTheDocument())
    await assertFocusInDialog()

    await expect(args.onOpenChange).not.toHaveBeenCalled()
    await expect(args.onNoteChange).not.toHaveBeenCalled()
    await expect(args.onServingOverrideChange).not.toHaveBeenCalled()

    dialog.focus()
    await pressEscape()
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

/**
 * The note opens from the ⋯ menu on the title row (HON-966): "Add note"
 * without one. The editor takes focus once the menu has closed, and Cancel
 * hands it back to the trigger. The trigger is a 44px target, like every
 * other in the view.
 */
export const NoteMenuAddNote: Story = {
  name: 'Note menu: Add note',
  args: { meal: tintedMeal, onNoteChange: fn() },
  play: async ({ args }) => {
    const dialog = await findDialog()
    const more = within(dialog).getByRole('button', { name: `More actions: ${mealFixture.name}` })
    await expect(box(more).height).toBeGreaterThanOrEqual(44)
    await expect(box(more).width).toBeGreaterThanOrEqual(44)
    // On the title row, beside the name, and no standalone button below it.
    const title = within(dialog).getByRole('heading', { level: 2, name: mealFixture.name })
    await expect(box(more).top).toBeLessThan(box(title).bottom)
    await expect(box(more).left).toBeGreaterThanOrEqual(box(title).right)
    await expect(within(dialog).queryByRole('button', { name: 'Add note' })).toBeNull()

    await userEvent.click(more)
    const item = await body().findByRole('menuitem', { name: 'Add note' })
    await userEvent.click(item)
    const note = await within(dialog).findByRole('textbox', { name: 'Meal note' })
    await waitFor(() => expect(note).toHaveFocus())

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(note).not.toBeInTheDocument())
    await waitFor(() => expect(more).toHaveFocus())
    await expect(args.onNoteChange).not.toHaveBeenCalled()
    await expect(args.onOpenChange).not.toHaveBeenCalled()
  },
}

/** With a note the item reads "Edit note"; Save hands focus back to the trigger. */
export const NoteMenuEditNote: Story = {
  name: 'Note menu: Edit note',
  args: {
    meal: tintedMeal,
    note: 'Kids loved this — double the garlic next time.',
    onNoteChange: fn(),
  },
  parameters: {
    msw: {
      handlers: {
        entry: [
          http.patch('/api/meal-plans/:planId/entries/:entryId', () =>
            HttpResponse.json({ ok: true }),
          ),
        ],
      },
    },
  },
  play: async ({ args }) => {
    const dialog = await findDialog()
    const more = within(dialog).getByRole('button', { name: `More actions: ${mealFixture.name}` })
    await userEvent.click(more)
    await expect(body().queryByRole('menuitem', { name: 'Add note' })).toBeNull()
    await userEvent.click(await body().findByRole('menuitem', { name: 'Edit note' }))
    const note = await within(dialog).findByRole('textbox', { name: 'Meal note' })
    await waitFor(() => expect(note).toHaveFocus())
    await expect(note).toHaveValue(args.note)

    await userEvent.type(note, ' Add lemon zest.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(args.onNoteChange).toHaveBeenCalledWith(
        'Kids loved this — double the garlic next time. Add lemon zest.',
      ),
    )
    await waitFor(() => expect(more).toHaveFocus())
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

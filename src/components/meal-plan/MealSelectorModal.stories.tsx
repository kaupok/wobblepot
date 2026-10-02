import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, mocked, userEvent, waitFor, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import { track } from '@/lib/analytics'
import type { ImaginedMealResponse } from '@/lib/imagine-utils'
import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
  openViaTrigger,
  pressEscape,
} from '@/stories/a11y-helpers'
import {
  emptyMealsHandlers,
  errorMealsHandlers,
  loadingMealsHandlers,
  rateLimitedSuggestionsHandlers,
} from '@/stories/msw-handlers'
import { MealSelectorModal } from './MealSelectorModal'

const meta = {
  title: 'Meal plan/MealSelectorModal',
  component: MealSelectorModal,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Meal picker with search, “my recipes only” filter and AI-imagine mode. Queries are served by MSW handlers from `src/stories/msw-handlers.ts`; per-story overrides below force specific states.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    planId: 'plan-1',
    entryId: 'entry-1',
    householdSize: 4,
    mealType: MealType.dinner,
    onSwapComplete: fn(),
  },
} satisfies Meta<typeof MealSelectorModal>

export default meta
type Story = StoryObj<typeof meta>

export const SwapMode: Story = {
  args: {
    mode: 'swap',
    currentMealName: 'Lemon-garlic roast chicken',
  },
}

export const AddMode: Story = {
  args: {
    mode: 'add',
  },
}

export const BreakfastSlot: Story = {
  args: {
    mode: 'add',
    mealType: MealType.breakfast,
  },
}

const PHONE = { viewport: { value: 'mobileIphone', isRotated: false } }
const LAPTOP = { viewport: { value: 'laptop', isRotated: false } }

/** Width of the title's displayed form laid out on one line, from a clone. */
function unwrappedWidth(title: HTMLElement) {
  const shown = Array.from(title.children).find((form) => form.getClientRects().length > 0)
  const probe = shown!.cloneNode(true) as HTMLElement
  probe.style.cssText = 'position:absolute;display:inline-block;white-space:nowrap'
  title.appendChild(probe)
  // `offsetWidth` is layout width, unaffected by the dialog's zoom-in transform.
  const width = probe.offsetWidth
  probe.remove()
  return width
}

/**
 * The width a phone gives the title: below `sm` the dialog is the viewport
 * less 2rem, then its border, its padding and the header's padding. Computed
 * rather than read off the title, because the harness narrows the dialog with
 * classic scrollbars that a phone's overlay scrollbars do not take.
 */
function phoneTitleWidth(dialog: HTMLElement, title: HTMLElement) {
  const box = getComputedStyle(dialog)
  const header = getComputedStyle(title.parentElement!)
  return [
    box.borderLeftWidth,
    box.borderRightWidth,
    box.paddingLeft,
    box.paddingRight,
    header.paddingLeft,
    header.paddingRight,
  ].reduce((width, inset) => width - parseFloat(inset), window.innerWidth - 32)
}

/**
 * Asserts the slot title's accessible name, that it fits on one line, and
 * that the dialog has no description: the title names the slot (HON-941).
 * Only one of the title's two forms is displayed at a time, so the name is
 * whichever the viewport shows.
 */
async function expectSlotTitle(name: string, dimmedDate?: string) {
  const dialog = await within(document.body).findByRole('dialog')
  const title = within(dialog).getByRole('heading', { level: 2 })
  await expect(title).toHaveAccessibleName(name)
  await expect(dialog).not.toHaveAttribute('aria-describedby')
  // Measured in Geist, at both weights the title uses: the fallback font is
  // wider and fails a title that fits. `fonts.ready` alone can resolve before
  // a face has been requested.
  await Promise.all(
    [title, ...title.querySelectorAll('span')].map((el) =>
      document.fonts.load(getComputedStyle(el).font, el.textContent ?? undefined),
    ),
  )
  await expect(unwrappedWidth(title)).toBeLessThanOrEqual(
    window.innerWidth < 640 ? phoneTitleWidth(dialog, title) : title.clientWidth,
  )
  const dimmed = Array.from(title.querySelectorAll('.text-muted-foreground')).filter(
    (el) => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0,
  )
  await expect(dimmed.map((el) => el.textContent)).toEqual(dimmedDate ? [dimmedDate] : [])
}

/**
 * Opened from an empty slot: the title names the slot in one line, with the
 * date dimmed as on the timeline's day heading (HON-807, HON-941). On a phone
 * the short form fits even for the widest slot of the year: measured across
 * every date and meal type, that is Wednesday May 20 at breakfast.
 */
export const DatedSlotPhone: Story = {
  args: { mode: 'add', mealType: MealType.breakfast, date: '2026-05-20' },
  globals: PHONE,
  play: async () => {
    await expectSlotTitle('Breakfast for Wed May 20', 'May 20')
  },
}

export const DatedSlotLaptop: Story = {
  args: { mode: 'add', mealType: MealType.breakfast, date: '2026-10-08' },
  globals: LAPTOP,
  play: async () => {
    await expectSlotTitle('Pick a breakfast for Thursday Oct 8', 'Oct 8')
  },
}

/**
 * Estonian joins with a separator, so the weekday needs no declension. Its
 * widest slot of the year is Friday March 20 at breakfast.
 */
export const DatedSlotPhoneEstonian: Story = {
  args: { mode: 'add', mealType: MealType.breakfast, date: '2026-03-20' },
  globals: { ...PHONE, locale: 'et' },
  play: async () => {
    await expectSlotTitle('Hommikusöök: R 20. märts', '20. märts')
  },
}

/** Today and tomorrow carry no date, as on the timeline's day heading. */
export const TodaySlotPhone: Story = {
  args: { mode: 'add', mealType: MealType.dinner, date: '2026-10-02', relativeDay: 'today' },
  globals: PHONE,
  play: async () => {
    await expectSlotTitle('Dinner for today')
  },
}

export const TodaySlotLaptop: Story = {
  args: { mode: 'add', mealType: MealType.dinner, date: '2026-10-02', relativeDay: 'today' },
  globals: LAPTOP,
  play: async () => {
    await expectSlotTitle('Pick a dinner for today')
  },
}

export const TomorrowSlotLaptop: Story = {
  args: { mode: 'add', mealType: MealType.lunch, date: '2026-10-03', relativeDay: 'tomorrow' },
  globals: LAPTOP,
  play: async () => {
    await expectSlotTitle('Pick a lunch for tomorrow')
  },
}

export const Populated: Story = {
  args: {
    mode: 'swap',
    currentMealName: 'Lemon-garlic roast chicken',
  },
  parameters: {
    docs: {
      description: {
        story: 'Default MSW handlers serve three suggested alternatives.',
      },
    },
  },
}

export const Empty: Story = {
  args: { mode: 'add' },
  parameters: {
    msw: { handlers: emptyMealsHandlers },
    docs: {
      description: {
        story:
          'Suggestions endpoint returns an empty array — component shows the empty-state copy.',
      },
    },
  },
}

export const ErrorState: Story = {
  name: 'Error',
  args: { mode: 'add' },
  parameters: {
    msw: { handlers: errorMealsHandlers },
    docs: {
      description: {
        story:
          'Suggestions endpoint returns a 500 — `useQuery` surfaces no data, so the empty-state copy renders deterministically.',
      },
    },
  },
}

export const RateLimited: Story = {
  args: { mode: 'swap' },
  parameters: {
    msw: { handlers: rateLimitedSuggestionsHandlers },
    docs: {
      description: {
        story:
          'The shared `meal-suggestions` bucket is exhausted — `/regenerate` answers 429, so the list explains the limit instead of claiming there are no suggestions.',
      },
    },
  },
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByText(/too many suggestion requests/i)).toBeInTheDocument()
  },
}

export const Loading: Story = {
  args: { mode: 'add' },
  parameters: {
    msw: { handlers: loadingMealsHandlers },
    docs: {
      description: {
        story:
          'Handlers never resolve — component stays in its skeleton loading state. The skeletons carry no 3:2 image band (HON-943).',
      },
    },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog')
    await waitFor(() =>
      expect(dialog.querySelectorAll('[data-slot="card"]').length).toBeGreaterThanOrEqual(3),
    )
    await expect(dialog.querySelector('[data-shape="flush"]')).toBeNull()
  },
}

/**
 * The dialog at 1440px: three cards in a row, each Select `outline` and as
 * wide as its label rather than three equal filled bars (HON-943).
 */
export const PopulatedDesktop: Story = {
  args: {
    mode: 'swap',
    currentMealName: 'Lemon-garlic roast chicken',
  },
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async () => {
    const body = within(document.body)
    const buttons = await body.findAllByRole('button', { name: /^select$/i }, { timeout: 3000 })
    await expect(buttons.length).toBeGreaterThanOrEqual(3)
    for (const button of buttons) {
      const card = button.closest<HTMLElement>('[data-slot="card"]')!.getBoundingClientRect()
      await expect(button).toHaveAttribute('data-variant', 'outline')
      await expect(button.getBoundingClientRect().width).toBeLessThan(card.width / 2)
    }
  },
}

// Play stories — Radix Dialog portals outside `canvasElement`, so queries use
// `within(document.body)`. MSW handlers in `src/stories/msw-handlers.ts` back
// the search + select PATCH requests so callbacks fire deterministically.

export const SearchAndSelectInvokesCallbacks: Story = {
  args: {
    mode: 'swap',
    currentMealName: 'Lemon-garlic roast chicken',
  },
  play: async ({ args }) => {
    const body = within(document.body)
    await body.findByRole('dialog')

    const searchInput = await body.findByPlaceholderText('Search meal library…')
    await userEvent.type(searchInput, 'chicken')

    // Debounced search (300 ms) → MSW returns library meals
    await body.findByText('Lemon-garlic roast chicken', undefined, { timeout: 3000 })

    const selectButtons = await body.findAllByRole('button', { name: /^select$/i })
    await userEvent.click(selectButtons[0]!)

    // handleSelect awaits the PATCH before firing parent callbacks
    await waitFor(() => expect(args.onSwapComplete).toHaveBeenCalled())
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

/** Picks the first library meal ("Lemon-garlic roast chicken", `meal-chicken`) from a search. */
async function selectChickenFromSearch() {
  const body = within(document.body)
  await body.findByRole('dialog')
  await userEvent.type(await body.findByPlaceholderText('Search meal library…'), 'chicken')
  await body.findByText('Lemon-garlic roast chicken', undefined, { timeout: 3000 })
  const selectButtons = await body.findAllByRole('button', { name: /^select$/i })
  await userEvent.click(selectButtons[0]!)
}

/** A real swap fires `meal_plan:meal_swapped` with `is_reselect: false` (HON-708). */
export const SwapFiresSwappedEvent: Story = {
  args: {
    mode: 'swap',
    currentMealName: 'Miso-glazed salmon with rice',
    currentMealId: 'meal-salmon',
  },
  beforeEach: () => {
    mocked(track).mockClear()
  },
  play: async ({ args }) => {
    await selectChickenFromSearch()

    await waitFor(() => expect(args.onSwapComplete).toHaveBeenCalledWith('meal-chicken'))
    await expect(track).toHaveBeenCalledTimes(1)
    await expect(track).toHaveBeenCalledWith('meal_plan:meal_swapped', {
      plan_id: 'plan-1',
      from_meal_id: 'meal-salmon',
      to_meal_id: 'meal-chicken',
      source: 'meal_selector',
      is_reselect: false,
      via: 'library',
    })
  },
}

/**
 * Search lists the meal already on the entry. Picking it still fires
 * `meal_plan:meal_swapped`, marked `is_reselect: true` so the swap funnel can
 * exclude it (HON-708).
 */
export const ReselectMarksSwappedEvent: Story = {
  args: {
    mode: 'swap',
    currentMealName: 'Lemon-garlic roast chicken',
    currentMealId: 'meal-chicken',
  },
  beforeEach: () => {
    mocked(track).mockClear()
  },
  play: async ({ args }) => {
    await selectChickenFromSearch()

    await waitFor(() => expect(args.onSwapComplete).toHaveBeenCalledWith('meal-chicken'))
    await expect(track).toHaveBeenCalledTimes(1)
    await expect(track).toHaveBeenCalledWith('meal_plan:meal_swapped', {
      plan_id: 'plan-1',
      from_meal_id: 'meal-chicken',
      to_meal_id: 'meal-chicken',
      source: 'meal_selector',
      is_reselect: true,
      via: 'library',
    })
  },
}

const imaginedStew: ImaginedMealResponse = {
  id: 'im-1',
  name: 'Smoky red lentil stew',
  description: 'Generated from your prompt.',
  timeMinutes: 30,
  servings: 4,
  suitableFor: ['dinner'],
  kidFriendly: true,
  primaryProteinType: 'legume',
  components: [
    {
      ingredientId: 'ing-lentil',
      quantityPerServing: 90,
      ingredient: { id: 'ing-lentil', name: 'Red lentils', category: 'protein', defaultUnit: 'g' },
    },
  ],
  nutrition: { calories: 480, protein: 24, carbs: 62, fat: 12 },
  // One matched row, so the review dialog has a component to save.
  ingredients: [
    {
      type: 'matched',
      extractedName: 'red lentils',
      extractedQuantity: 360,
      extractedUnit: 'g',
      originalText: '360 g red lentils',
      ingredient: {
        id: 'ing-lentil',
        name: 'Red lentils',
        category: 'protein',
        defaultUnit: 'g',
        gramsPerPiece: null,
      },
      convertedQuantity: 360,
      isVague: false,
    },
  ],
  allMatched: true,
}

/**
 * Imagine answers one meal and the quantity review passes it through. Keyed so
 * the defaults still serve the save (`POST /api/households/me/meals` →
 * `new-meal-123`) and the entry PATCH.
 */
const imagineHandlers = [
  http.post('/api/meals/imagine', () =>
    HttpResponse.json({ success: true, meals: [imaginedStew] }),
  ),
  http.post('/api/meals/imagine/review', () =>
    HttpResponse.json({ success: true, ingredients: [] }),
  ),
]

/** Imagines a meal in the selector and saves it, which assigns it to the entry. */
async function imagineAndSaveMeal() {
  const body = within(document.body)
  await body.findByRole('dialog')
  await userEvent.click(await body.findByRole('button', { name: /imagine a meal/i }))
  await userEvent.type(await body.findByRole('textbox'), 'something with lentils')
  await userEvent.click(body.getByRole('button', { name: /imagine meals/i }))
  await body.findByText('Smoky red lentil stew')
  await userEvent.click(body.getByRole('button', { name: /^select$/i }))
  await userEvent.click(await body.findByRole('button', { name: /^save recipe$/i }))
}

/**
 * Replacing a planned meal with an imagined one is a swap: it fires
 * `meal_plan:meal_swapped` with `via: 'imagine'`, alongside `meal:imagined`
 * (HON-890).
 */
export const ImagineSwapFiresSwappedEvent: Story = {
  args: {
    mode: 'swap',
    currentMealName: 'Miso-glazed salmon with rice',
    currentMealId: 'meal-salmon',
  },
  parameters: { msw: { handlers: { imagine: imagineHandlers } } },
  beforeEach: () => {
    mocked(track).mockClear()
  },
  play: async ({ args }) => {
    await imagineAndSaveMeal()

    await waitFor(() => expect(args.onSwapComplete).toHaveBeenCalledWith('new-meal-123'))
    await expect(track).toHaveBeenCalledWith('meal:imagined', {
      meal_id: 'new-meal-123',
      source: 'meal_selector',
    })
    const swapCalls = mocked(track).mock.calls.filter(([name]) => name === 'meal_plan:meal_swapped')
    await expect(swapCalls).toEqual([
      [
        'meal_plan:meal_swapped',
        {
          plan_id: 'plan-1',
          from_meal_id: 'meal-salmon',
          to_meal_id: 'new-meal-123',
          source: 'meal_selector',
          is_reselect: false,
          via: 'imagine',
        },
      ],
    ])
  },
}

/** Filling an empty slot with an imagined meal is not a swap (HON-890). */
export const ImagineAddFiresNoSwappedEvent: Story = {
  args: { mode: 'add' },
  parameters: { msw: { handlers: { imagine: imagineHandlers } } },
  beforeEach: () => {
    mocked(track).mockClear()
  },
  play: async ({ args }) => {
    await imagineAndSaveMeal()

    await waitFor(() => expect(args.onSwapComplete).toHaveBeenCalledWith('new-meal-123'))
    await expect(track).toHaveBeenCalledTimes(1)
    await expect(track).toHaveBeenCalledWith('meal:imagined', {
      meal_id: 'new-meal-123',
      source: 'meal_selector',
    })
  },
}

export const EscapeClosesDialog: Story = {
  args: { mode: 'add' },
  play: async ({ args }) => {
    const body = within(document.body)
    await body.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

// Interaction-a11y story — focus trap / tab containment / Escape / close-
// sequence completion. See `src/stories/a11y-helpers.ts`.
export const A11yInteractionPatterns: Story = {
  args: { open: false, mode: 'add' },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div>
        <button type="button" data-testid="a11y-trigger" onClick={() => setOpen(true)}>
          Open modal
        </button>
        <MealSelectorModal
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

import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, mocked, userEvent, waitFor, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import { track } from '@/lib/analytics'
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

/**
 * Opened from an empty slot on Today: the description names the slot, since
 * the dialog covers the row that was tapped (HON-807).
 */
export const AddModeWithSlot: Story = {
  args: {
    mode: 'add',
    mealType: MealType.breakfast,
    dayLabel: 'Saturday Oct 3',
  },
  play: async () => {
    await expect(await within(document.body).findByRole('dialog')).toHaveAccessibleDescription(
      'Saturday Oct 3 · Breakfast',
    )
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
        story: 'Handlers never resolve — component stays in its skeleton loading state.',
      },
    },
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

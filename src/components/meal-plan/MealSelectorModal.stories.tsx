import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
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

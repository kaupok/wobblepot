import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import {
  createMeal,
  lemonGarlicChickenPantry,
  lemonGarlicChickenPantryItems,
} from '@/stories/fixtures'
import { MealCard } from './MealCard'

const mealFixture = createMeal()

const meta = {
  title: 'Meal plan/MealCard',
  component: MealCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    entryId: 'entry-1',
    planId: 'plan-1',
    mealType: MealType.dinner,
    householdSize: 4,
    pantryIngredients: lemonGarlicChickenPantry,
    pantryItems: lemonGarlicChickenPantryItems,
  },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MealCard>

export default meta
type Story = StoryObj<typeof meta>

/** Swap and Clear live behind the card's "More actions" menu (HON-688). */
async function openMoreActions(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /more actions/i }))
}

export const Planned: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // Every control on the card clears the 32px `sm` floor (HON-688) — the
    // meal name included, which is a wrapping text button rather than a
    // `Button` and so takes its height from `min-h-8`, not a size variant.
    for (const button of canvas.getAllByRole('button')) {
      await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(32)
    }

    // The counterpart to `CompletedThumbsUp` below: Swap is offered here, so
    // its absence there cannot pass on a card that failed to render at all.
    await openMoreActions(canvasElement)
    await expect(
      await within(document.body).findByRole('menuitem', { name: /^swap$/i }),
    ).toBeInTheDocument()
  },
}

export const PlannedAlreadyCharged: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    pantryDeducted: true,
    // The status control only renders on past days.
    isPast: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Completed once, then reverted to planned. The pantry was already charged and the server never charges an entry twice (HON-651), so completing again skips the deduction preview.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.click(canvas.getByRole('combobox', { name: /meal status/i }))
    await userEvent.click(await body.findByRole('option', { name: /completed/i }))

    // The status did change — so the missing dialog below is not a click that
    // never landed.
    await waitFor(() =>
      expect(canvas.getByRole('combobox', { name: /meal status/i })).toHaveTextContent(
        /completed/i,
      ),
    )
    await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
  },
}

export const PlannedWithNote: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    note: 'Double the garlic — kids approved.',
  },
}

export const WithServingOverride: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    servingOverride: 6,
  },
}

export const LowAvailability: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    pantryIngredients: [{ ingredientId: 'garlic', isStaple: true }],
  },
  parameters: {
    docs: {
      description: {
        story: 'Most ingredients missing from pantry — shows amber availability indicator.',
      },
    },
  },
}

export const CompletedThumbsUp: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: 'up',
  },
  parameters: {
    docs: {
      description: {
        story:
          'No Swap control: a completed entry records what was cooked and what the pantry was charged for, and the API refuses to repoint it (409, HON-633). Note and Clear stay available.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)
    await openMoreActions(canvasElement)
    // Clear is in the same menu, so the missing Swap is not a menu that never
    // opened. Note sits outside it and is unaffected.
    await expect(await body.findByRole('menuitem', { name: /^clear$/i })).toBeInTheDocument()
    await expect(body.queryByRole('menuitem', { name: /^swap$/i })).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /^note$/i })).toBeInTheDocument()
  },
}

export const CompletedThumbsDown: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: 'down',
  },
}

export const CompletedUnrated: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: null,
  },
}

export const Skipped: Story = {
  args: {
    meal: mealFixture,
    status: 'skipped',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Swap is still offered: nothing was deducted for a skipped meal, so “actually, let’s cook something” stays a legitimate path (HON-633).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await openMoreActions(canvasElement)
    await expect(
      await within(document.body).findByRole('menuitem', { name: /^swap$/i }),
    ).toBeInTheDocument()
  },
}

export const PastCompleted: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: 'up',
    isPast: true,
  },
}

export const PastReadonly: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: 'up',
    isPast: true,
    isReadOnly: true,
  },
}

export const EmptyPlanned: Story = {
  args: {
    meal: null,
    status: 'planned',
  },
}

export const EmptyWithNote: Story = {
  args: {
    meal: null,
    status: 'planned',
    note: 'Maybe leftovers tonight.',
  },
}

export const EmptyReadonly: Story = {
  args: {
    meal: null,
    status: 'planned',
    isReadOnly: true,
  },
}

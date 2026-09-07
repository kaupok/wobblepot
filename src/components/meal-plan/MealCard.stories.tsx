import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
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

export const Planned: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
  },
  play: async ({ canvasElement }) => {
    // The counterpart to `CompletedThumbsUp` below: Swap is offered here, so
    // its absence there cannot pass on a card that failed to render at all.
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /^swap$/i })).toBeInTheDocument()
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
    await expect(canvas.queryByRole('button', { name: /^swap$/i })).not.toBeInTheDocument()
    // The other two header controls are unaffected — this hides Swap, not the
    // whole control row.
    await expect(canvas.getByRole('button', { name: /^note$/i })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /^clear$/i })).toBeInTheDocument()
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
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /^swap$/i })).toBeInTheDocument()
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

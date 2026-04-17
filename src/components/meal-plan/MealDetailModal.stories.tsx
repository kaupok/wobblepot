import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import {
  createMeal,
  lemonGarlicChickenComponentsFull,
  lemonGarlicChickenPantryWithOil,
} from '@/stories/fixtures'
import { MealDetailModal } from './MealDetailModal'

const mealFixture = createMeal({ components: lemonGarlicChickenComponentsFull })

const meta = {
  title: 'Meal plan/MealDetailModal',
  component: MealDetailModal,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Wraps MealDetail in a Dialog — portal-based. Use the theme toolbar to verify dark mode styles the overlay + content correctly.',
      },
    },
  },
  args: {
    meal: mealFixture,
    householdSize: 4,
    open: true,
    onOpenChange: fn(),
    planId: 'plan-1',
    entryId: 'entry-1',
    pantryIngredients: lemonGarlicChickenPantryWithOil,
  },
} satisfies Meta<typeof MealDetailModal>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {}

export const WithNote: Story = {
  args: {
    note: 'Kids loved this — double the garlic next time.',
    onNoteChange: fn(),
  },
}

export const WithServingOverride: Story = {
  args: {
    servingOverride: 6,
    onServingOverrideChange: fn(),
  },
}

export const WithPreparationNotes: Story = {
  args: {
    meal: createMeal({
      components: lemonGarlicChickenComponentsFull,
      preparationNotes:
        'Broil last 2 minutes for crispier skin. Serve with steamed green beans and flaky salt.',
    }),
  },
}

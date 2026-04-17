import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { createPantryItem, lemonGarlicChickenComponents } from '@/stories/fixtures'
import { PantryDeductionModal } from './PantryDeductionModal'

const pantryItems = [
  createPantryItem({ ingredientId: 'chicken-thigh', quantity: 800, isStaple: false }),
  createPantryItem({ ingredientId: 'potato', quantity: 500, isStaple: false }),
  createPantryItem({ ingredientId: 'lemon', quantity: 1, isStaple: false }),
  createPantryItem({ ingredientId: 'garlic', quantity: 10, isStaple: true }),
]

const meta = {
  title: 'Meal plan/PantryDeductionModal',
  component: PantryDeductionModal,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Confirms which pantry items will be deducted when marking a meal as completed — portal-based.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    onConfirm: fn(),
    mealName: 'Lemon-garlic roast chicken',
    components: lemonGarlicChickenComponents,
    householdSize: 4,
    pantryItems,
  },
} satisfies Meta<typeof PantryDeductionModal>

export default meta
type Story = StoryObj<typeof meta>

export const WithDeductions: Story = {}

export const SomeItemsRemoved: Story = {
  args: {
    householdSize: 8,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Doubling the serving size exhausts several pantry items — they’ll be removed after.',
      },
    },
  },
}

export const NoDeductions: Story = {
  args: {
    pantryItems: [],
  },
  parameters: {
    docs: {
      description: {
        story: 'Empty pantry — nothing will be deducted, modal asks for simple confirmation.',
      },
    },
  },
}

export const OnlyStaples: Story = {
  args: {
    components: [lemonGarlicChickenComponents[3]!],
    pantryItems: [pantryItems[3]!],
  },
  parameters: {
    docs: {
      description: { story: 'Staples are never deducted, so the list is empty.' },
    },
  },
}

export const Loading: Story = {
  args: {
    isLoading: true,
  },
}

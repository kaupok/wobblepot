import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { PantryDeductionModal } from './PantryDeductionModal'
import type { MealComponent, PantryItemFull } from './types'

const components: MealComponent[] = [
  {
    ingredientId: 'chicken-thigh',
    quantityPerServing: 150,
    ingredient: {
      id: 'chicken-thigh',
      name: 'Chicken thigh',
      category: 'protein',
      defaultUnit: 'g',
      gramsPerPiece: null,
    },
  },
  {
    ingredientId: 'potato',
    quantityPerServing: 200,
    ingredient: {
      id: 'potato',
      name: 'Potato',
      category: 'produce',
      defaultUnit: 'g',
      gramsPerPiece: null,
    },
  },
  {
    ingredientId: 'lemon',
    quantityPerServing: 0.5,
    ingredient: {
      id: 'lemon',
      name: 'Lemon',
      category: 'produce',
      defaultUnit: 'piece',
      gramsPerPiece: 60,
    },
  },
  {
    ingredientId: 'garlic',
    quantityPerServing: 2,
    ingredient: {
      id: 'garlic',
      name: 'Garlic',
      category: 'aromatic',
      defaultUnit: 'piece',
      gramsPerPiece: 5,
    },
  },
]

const pantryItems: PantryItemFull[] = [
  {
    id: 'p-1',
    ingredientId: 'chicken-thigh',
    quantity: 800,
    isStaple: false,
    ingredient: {
      id: 'chicken-thigh',
      name: 'Chicken thigh',
      category: 'protein',
      defaultUnit: 'g',
    },
  },
  {
    id: 'p-2',
    ingredientId: 'potato',
    quantity: 500,
    isStaple: false,
    ingredient: {
      id: 'potato',
      name: 'Potato',
      category: 'produce',
      defaultUnit: 'g',
    },
  },
  {
    id: 'p-3',
    ingredientId: 'lemon',
    quantity: 1,
    isStaple: false,
    ingredient: {
      id: 'lemon',
      name: 'Lemon',
      category: 'produce',
      defaultUnit: 'piece',
    },
  },
  {
    id: 'p-4',
    ingredientId: 'garlic',
    quantity: 10,
    isStaple: true,
    ingredient: {
      id: 'garlic',
      name: 'Garlic',
      category: 'aromatic',
      defaultUnit: 'piece',
    },
  },
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
    components,
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
    components: [components[3]!],
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

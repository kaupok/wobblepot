import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import {
  createMeal,
  lemonGarlicChickenComponentsFull,
  lemonGarlicChickenPantryWithOil,
} from '@/stories/fixtures'
import { MealDetail } from './MealDetail'
import type { StructuredTips } from './types'

const mealFixture = createMeal({ components: lemonGarlicChickenComponentsFull })

const tips: StructuredTips = {
  equipment: ['Sheet pan', 'Sharp knife', 'Tongs'],
  steps: [
    'Heat oven to 220°C.',
    'Season chicken with salt, pepper and olive oil.',
    'Arrange on sheet pan with lemon halves and smashed garlic.',
    'Roast 35 min until golden and juices run clear.',
  ],
  pitfalls: ['Don’t crowd the pan.', 'Rest 5 minutes before slicing.'],
  tip: 'Deglaze the pan with a splash of wine to make a quick sauce.',
}

const meta = {
  title: 'Meal plan/MealDetail',
  component: MealDetail,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    meal: mealFixture,
    householdSize: 4,
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl rounded-lg border p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MealDetail>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithPantry: Story = {
  args: { pantryIngredients: lemonGarlicChickenPantryWithOil },
}

export const WithServingControl: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    servings: 4,
    onServingsChange: fn(async () => true),
  },
}

export const TipsCollapsed: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    onHowToPrepare: fn(),
  },
}

export const TipsExpanded: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    tips,
    isTipsExpanded: true,
    onHowToPrepare: fn(),
    onHideTips: fn(),
  },
}

export const TipsLoading: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    isLoadingTips: true,
    isTipsExpanded: true,
    onHowToPrepare: fn(),
  },
}

export const TipsError: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    tipsError: 'Failed to load tips.',
    isTipsExpanded: true,
    onHowToPrepare: fn(),
    onRetryTips: fn(),
  },
}

export const WithPreparationNotes: Story = {
  args: {
    meal: createMeal({
      components: lemonGarlicChickenComponentsFull,
      preparationNotes: 'Add extra thyme. Kids prefer the skin crispy — broil last 2 min.',
    }),
    tips,
    isTipsExpanded: true,
    onHowToPrepare: fn(),
    onHideTips: fn(),
  },
}

export const HideAvailability: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    hideAvailability: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'For completed/skipped meals — hides checkboxes and missing-ingredient styling.',
      },
    },
  },
}

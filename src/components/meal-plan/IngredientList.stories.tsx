import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { createMealComponent, lemonGarlicChickenComponentsFull } from '@/stories/fixtures'
import { IngredientList } from './IngredientList'
import type { PantryIngredient } from './types'

const vagueSalt = createMealComponent({
  ingredientId: 'salt',
  quantityPerServing: 1,
  isVague: true,
  originalPhrase: 'to taste',
})

const componentsWithVagueSalt = [...lemonGarlicChickenComponentsFull, vagueSalt]

const meta = {
  title: 'Meal plan/IngredientList',
  component: IngredientList,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    components: componentsWithVagueSalt,
    servings: 4,
    householdSize: 4,
  },
  decorators: [
    (Story) => (
      <div className="max-w-md rounded-lg border p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IngredientList>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Compact: Story = {
  args: { compact: true },
}

export const WithPantryAvailability: Story = {
  args: {
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
      { ingredientId: 'olive-oil', isStaple: true },
      { ingredientId: 'salt', isStaple: true },
    ] satisfies PantryIngredient[],
  },
}

export const WithCheckboxes: Story = {
  args: {
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
      { ingredientId: 'olive-oil', isStaple: true },
    ] satisfies PantryIngredient[],
    onToggleAvailability: fn(),
  },
}

export const WithAvailabilityBadge: Story = {
  args: {
    availability: {
      isReady: false,
      missingCount: 2,
      missingIngredients: ['Potato', 'Lemon'],
    },
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
    ] satisfies PantryIngredient[],
  },
}

export const HideAvailability: Story = {
  args: {
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
    ] satisfies PantryIngredient[],
    hideAvailability: true,
  },
}

export const LargerServings: Story = {
  args: { servings: 8, householdSize: 4 },
}

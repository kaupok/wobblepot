import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { RecipesGridSkeleton } from './RecipesGridSkeleton'

const meta = {
  title: 'Feature/Recipes/RecipesGridSkeleton',
  component: RecipesGridSkeleton,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "Loading placeholder for the recipe library grid — same columns as `MealList` (1 / 2 from `sm` / 3 from `lg`). Each card is the loaded card's shape: its content height above a 3:2 image block at the card's full width, so the placeholder grows with the column like the real card does. No ingredient list, as on the loaded cards (HON-819). Used by `src/app/recipes/loading.tsx` and `RecipesPageClient`'s loading state.",
      },
    },
  },
} satisfies Meta<typeof RecipesGridSkeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Few: Story = {
  args: { count: 2 },
}

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
          'Loading placeholder for the recipe library grid — same columns as `MealList` (1 / 2 from `sm` / 3 from `lg`). Used by `src/app/recipes/loading.tsx`.',
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

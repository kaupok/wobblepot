import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'

import { Body } from '@/components/ui/typography'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'

import { CookViewDialog } from './CookViewDialog'

const meta = {
  title: 'Meal plan/CookViewDialog',
  component: CookViewDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The cook view’s dialog shell: the full-screen panel and its tint, the hero, the title with the "My recipe" mark, the phone’s sticky bar, the wake lock, and focus in and out. `MealDetailModal` (a planned entry) and `RecipeDetailModal` (a My recipes recipe, HON-1338) fill it with `MealDetail`. Here the body is a placeholder that shows the hero and title it is handed.',
      },
    },
  },
  args: {
    meal: { name: 'Lemon-garlic roast chicken', isCustom: true },
    open: true,
    onOpenChange: fn(),
    image: { status: 'ready', imageUrl: mealIllustration.src, imageHue: 52 },
    children: ({ image, title }) => (
      <div data-slot="cook-view-scroll" className="flex flex-col gap-4 overflow-y-auto p-8">
        {image}
        {title}
        <Body>The view’s body goes here.</Body>
      </div>
    ),
  },
} satisfies Meta<typeof CookViewDialog>

export default meta
type Story = StoryObj<typeof meta>

/** Tinted by the image's hue; the dialog is named by the meal. */
export const WithImage: Story = {
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', {
      name: 'Lemon-garlic roast chicken',
    })
    await expect(dialog).toHaveAttribute('data-meal-surface', '')
  },
}

/** No image: the plain background, and no hero. */
export const WithoutImage: Story = {
  args: {
    meal: { name: 'Lentil soup' },
    image: { status: 'none', imageUrl: null, imageHue: null },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Lentil soup' })
    await expect(dialog).not.toHaveAttribute('data-meal-surface')
  },
}

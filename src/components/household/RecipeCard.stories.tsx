import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Heart } from 'lucide-react'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/components/ui/button'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { householdMealList } from '@/stories/fixtures'

import { RecipeCard } from './RecipeCard'

const meal = householdMealList[0]!

const meta = {
  title: 'Feature/Household/RecipeCard',
  component: RecipeCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One recipe on My recipes (`MealList`). A click on the name, the image or anywhere that is not a control calls `onOpen`, which opens the recipe’s cook view (HON-1338). The name is the keyboard target; the title-row controls (`titleActions`) keep their own actions. A recipe whose image is being drawn shows a plain `bg-muted` box in the image slot and re-reads `GET /api/meals/:id/image` every 5 s for at most 90 s, then shows the image with its tint (HON-1364).',
      },
    },
  },
  args: {
    meal,
    onOpen: fn(),
    titleActions: (
      <Button variant="ghost" size="icon-sm" aria-label="Add to favourites">
        <Heart aria-hidden="true" />
      </Button>
    ),
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RecipeCard>

export default meta
type Story = StoryObj<typeof meta>

/** The name opens the view, and the keyboard reaches it. */
export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const name = within(canvasElement).getByRole('button', { name: meal.name })
    await userEvent.click(name)
    await expect(args.onOpen).toHaveBeenCalledTimes(1)
    await expect(name).toHaveFocus()
  },
}

/** A click on the image opens the view and puts focus on the name. */
export const WithImage: Story = {
  args: {
    meal: { ...meal, imageStatus: 'ready', imageUrl: mealIllustration.src, imageHue: 52 },
  },
  play: async ({ args, canvasElement }) => {
    // The image mounts once its source has loaded.
    const image = await waitFor(() => {
      const img = canvasElement.querySelector('img')
      if (!img) throw new Error('The card renders no image yet')
      return img
    })
    await userEvent.click(image)
    await expect(args.onOpen).toHaveBeenCalledTimes(1)
    await expect(within(canvasElement).getByRole('button', { name: meal.name })).toHaveFocus()
  },
}

/**
 * The household's cook history under the name, as on the picker's cards
 * (HON-1389): "Cooked 12 days ago", and the next planned day.
 */
export const CookHistory: Story = {
  args: {
    meal: { ...meal, lastCookedOn: '2026-10-16', nextPlannedOn: '2026-10-31' },
    today: '2026-10-28',
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Cooked 12 days ago · Planned: Sat, Oct 31'),
    ).toBeVisible()
  },
}

/** A recipe never cooked says so. */
export const NotCookedYet: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Not cooked yet')).toBeVisible()
  },
}

/** A control on the title row keeps its own action: the view stays shut. */
export const ControlDoesNotOpen: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Add to favourites' }))
    await expect(args.onOpen).not.toHaveBeenCalled()
  },
}

/**
 * A just-saved recipe whose image is still being drawn: a plain box holds the
 * image's slot, with no icon or animation (HON-1364).
 */
export const Generating: Story = {
  args: { meal: { ...meal, imageStatus: 'generating', imageUrl: null, imageHue: null } },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/meals/:id/image', () => HttpResponse.json({ status: 'generating' })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByTestId('meal-card-image-generating')
    await expect(box).toHaveClass('bg-muted')
    await expect(box).toBeEmptyDOMElement()
    await expect(canvasElement.querySelector('img')).toBeNull()
  },
}

/** The image is ready at the first re-read: the box gives way to the image and its tint. */
export const GeneratingThenReady: Story = {
  args: { meal: { ...meal, imageStatus: 'generating', imageUrl: null, imageHue: null } },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/meals/:id/image', () =>
          HttpResponse.json({ status: 'ready', imageUrl: mealIllustration.src, imageHue: 52 }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      if (!canvasElement.querySelector('img')) throw new Error('The card renders no image yet')
    })
    await expect(
      within(canvasElement).queryByTestId('meal-card-image-generating'),
    ).not.toBeInTheDocument()
    await expect(canvasElement.querySelector('[data-meal-surface=""]')).not.toBeNull()
  },
}

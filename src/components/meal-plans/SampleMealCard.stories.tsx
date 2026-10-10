import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import type { SampleDay } from '@/lib/meal-plans/build-sample-week'
import { SampleMealCard } from './SampleMealCard'

const day: SampleDay = {
  dayName: 'Monday',
  anchor: 'monday',
  meal: {
    id: 'sample-monday',
    name: 'Spaghetti Bolognese',
    description: 'Classic Italian meat sauce with spaghetti',
    kidFriendly: true,
    timeMinutes: 45,
    primaryProteinType: 'beef',
    imageUrl: mealIllustration.src,
    imageStatus: 'ready',
    imageHue: 51,
  },
  ingredients: [
    { id: 'mince', name: 'beef mince', quantity: '450g', isVague: false },
    { id: 'spaghetti', name: 'spaghetti', quantity: '300g', isVague: false },
    { id: 'passata', name: 'passata', quantity: '450ml', isVague: false },
    { id: 'onion', name: 'onion', quantity: '2 pc', isVague: false },
    { id: 'garlic', name: 'garlic', quantity: '15g', isVague: false },
    { id: 'salt', name: 'salt', quantity: 'to taste', isVague: true },
  ],
}

const meta = {
  title: 'Meal plans/SampleMealCard',
  component: SampleMealCard,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "One day of a public sample week (`/meal-plans/<slug>`, HON-1085): the dinner on the planner's card with the day in the slot badge's place, then its ingredients with the quantities for the page's household. A picture, not a control.",
      },
    },
  },
  args: { day },
} satisfies Meta<typeof SampleMealCard>

export default meta
type Story = StoryObj<typeof meta>

/** A meal with a ready illustration: the card takes its tint. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Spaghetti Bolognese' })).toBeVisible()
    const list = canvas.getByRole('list', { name: 'Ingredients: Spaghetti Bolognese' })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(6)
    // A picture of the plan: nothing on it is a button.
    await expect(canvas.queryByRole('button', { name: 'Spaghetti Bolognese' })).toBeNull()
  },
}

/** No ready image: the card's neutral surface, as on the planner. */
export const WithoutImage: Story = {
  args: {
    day: {
      ...day,
      meal: { ...day.meal, imageUrl: null, imageStatus: 'none', imageHue: null },
    },
  },
}

/** Not kid-friendly, no protein badge, no time and no description. */
export const Minimal: Story = {
  args: {
    day: {
      ...day,
      dayName: 'Friday',
      anchor: 'friday',
      meal: {
        ...day.meal,
        name: 'Roasted Vegetables',
        kidFriendly: false,
        primaryProteinType: 'none',
        timeMinutes: null,
        description: null,
        imageUrl: null,
        imageStatus: 'none',
        imageHue: null,
      },
      ingredients: day.ingredients.slice(3),
    },
  },
}

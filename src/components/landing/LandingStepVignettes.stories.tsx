import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { PlanDayVignette, ShoppingVignette } from './LandingStepVignettes'

const meta = {
  title: 'Landing/LandingStepVignettes',
  component: PlanDayVignette,
  tags: ['autodocs'],
  // In the page each picture sits on a white panel; the panel is `inert`.
  decorators: [
    (Story) => (
      <div className="bg-background max-w-sm rounded-2xl p-4">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The pictures above steps 2 and 3 of "Three steps to a planned week" in landing direction B1 (HON-1116), built from the app’s own components in a fixed state. Step 2 is a planner day with dinner planned and the empty slot’s "+ Breakfast" and "+ Lunch" buttons on the heading line; step 3 is the shopping list by aisle. Step 1 is `HouseholdVignette` (`Landing/LandingFeatures`).',
      },
    },
  },
} satisfies Meta<typeof PlanDayVignette>

export default meta
type Story = StoryObj<typeof meta>

/** Step 2: Thursday's dinner planned, breakfast and lunch still to add. */
export const PlanDay: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Thursday')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Breakfast' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Lunch' })).toBeInTheDocument()
    await expect(canvas.getByText('Baked salmon with asparagus')).toBeInTheDocument()
  },
}

/** Step 3: the salmon and lemon to buy, the asparagus already ticked. */
export const Shopping: Story = {
  render: () => <ShoppingVignette />,
  // WHY: a purchased item is deliberately de-emphasized (WCAG 1.4.3 exempts
  // inactive UI), as in `Shopping/CategoryGroup`; the ticked asparagus is one.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Salmon fillet')).toBeInTheDocument()
    await expect(canvas.getAllByRole('checkbox')).toHaveLength(3)
    await expect(canvas.getByRole('checkbox', { checked: true })).toBeInTheDocument()
  },
}

/** Step 2 in the dark theme. */
export const Dark: Story = { globals: { theme: 'dark' } }

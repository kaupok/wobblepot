import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { ShoppingVignette, TableVignette, WeekVignette } from './LandingStepVignettes'

const meta = {
  title: 'Landing/LandingStepVignettes',
  component: TableVignette,
  tags: ['autodocs'],
  // In the page each picture sits on a white panel; the panel is `inert`.
  decorators: [
    (Story) => (
      <div className="bg-background max-w-sm rounded-2xl px-5 py-2">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The pictures above the three steps of "Three steps to a planned week" in landing direction B1 (HON-1116). Each is three rows in one shape: a mark, a name, a detail on the right. Step 1 is the household, step 2 three dinners, step 3 the shopping list.',
      },
    },
  },
} satisfies Meta<typeof TableVignette>

export default meta
type Story = StoryObj<typeof meta>

/** Step 1: the three household members, the toddler with a peanut allergy. */
export const Table: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('listitem')).toHaveLength(3)
    await expect(canvas.getByText('Mia (2)')).toBeInTheDocument()
    await expect(canvas.getByText('Peanuts')).toBeInTheDocument()
  },
}

/** Step 2: Thursday's showcase dinner, then Friday and Saturday. */
export const Week: Story = {
  render: () => <WeekVignette />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Thu')).toBeInTheDocument()
    await expect(canvas.getByText('Baked salmon with asparagus')).toBeInTheDocument()
    await expect(canvas.getByText('90 min')).toBeInTheDocument()
  },
}

/** Step 3: the salmon and lemon to buy, the asparagus already ticked. */
export const Shopping: Story = {
  render: () => <ShoppingVignette />,
  // WHY: a ticked item is deliberately de-emphasized (WCAG 1.4.3 exempts
  // inactive UI), as in `Shopping/CategoryGroup`; the asparagus is one.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('checkbox')).toHaveLength(3)
    await expect(canvas.getByRole('checkbox', { name: 'Asparagus' })).toBeChecked()
  },
}

/** Step 1 in the dark theme. */
export const Dark: Story = { globals: { theme: 'dark' } }

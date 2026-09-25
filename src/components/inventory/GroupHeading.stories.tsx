import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { GroupHeading } from './GroupHeading'

const meta = {
  title: 'Feature/Inventory/GroupHeading',
  component: GroupHeading,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The heading over a group of rows on `/shopping` and `/pantry` — staples, on hand, a category, an urgency bucket, "Other". Caption level under the column\'s Title, with an optional fact about the group right-aligned on the same line.',
      },
    },
  },
  args: {
    label: 'Staples (always stocked)',
    count: '4 items',
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GroupHeading>

export default meta
type Story = StoryObj<typeof meta>

export const WithCount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 3, name: 'Staples (always stocked)' }),
    ).toBeVisible()
    await expect(canvas.getByText('4 items')).toBeVisible()
  },
}

export const Progress: Story = {
  args: { label: '🥩 Protein (4)', count: '1/4' },
  parameters: {
    docs: {
      description: {
        story:
          'A shopping category once something in it is bought: the fact is the purchased fraction.',
      },
    },
  },
}

export const LabelOnly: Story = {
  args: { label: 'On hand', count: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 3 })).toHaveTextContent('On hand')
    // A `false` or absent count renders nothing beside the label.
    await expect(canvas.getByRole('heading', { level: 3 }).parentElement?.childElementCount).toBe(1)
  },
}

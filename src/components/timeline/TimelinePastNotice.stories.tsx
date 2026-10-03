import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { TimelinePastNotice } from './TimelinePastNotice'

const meta = {
  title: 'Feature/Timeline/TimelinePastNotice',
  component: TimelinePastNotice,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TimelinePastNotice>

export default meta
type Story = StoryObj<typeof meta>

export const SeveralToMark: Story = {
  args: { count: 3 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvasElement.querySelector('[data-slot="callout"]')).toHaveAttribute(
      'data-tone',
      'info',
    )
    await expect(canvas.getByText(/3 past meals are not marked yet/)).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Mark past meals' })).toHaveAttribute(
      'href',
      '/past-meals',
    )
  },
}

export const OneToMark: Story = {
  args: { count: 1 },
}

export const NothingToMark: Story = {
  args: { count: 0 },
  parameters: {
    docs: {
      description: { story: 'With nothing to mark the notice renders nothing.' },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-slot="callout"]')).toBeNull()
  },
}

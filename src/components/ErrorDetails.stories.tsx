import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { ErrorDetails } from './ErrorDetails'

const sampleError = new Error('Failed to load meal plan')
sampleError.stack = `Error: Failed to load meal plan
    at loadMealPlan (src/app/page.tsx:12:11)
    at async Page (src/app/page.tsx:20:3)`

const meta = {
  title: 'Feature/ErrorDetails',
  component: ErrorDetails,
  tags: ['autodocs'],
  // Storybook's static build runs as production, where the component renders
  // nothing by default; stories opt in so the block is reviewable.
  args: { error: sampleError, visible: true },
} satisfies Meta<typeof ErrorDetails>

export default meta
type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}

export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText('Error details'))
    await expect(canvas.getByText(/Failed to load meal plan/, { selector: 'pre' })).toBeVisible()
  },
}

export const WithoutStack: Story = {
  args: { error: new Error('Something went wrong') },
}

export const Hidden: Story = {
  args: { visible: false },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('details')).toBeNull()
  },
}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { GeneratingOverlay } from './GeneratingOverlay'

const meta = {
  title: 'Meal plan/GeneratingOverlay',
  component: GeneratingOverlay,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof GeneratingOverlay>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Fixed full-screen overlay with a spinner and rotating progress messages. After 10s without change it switches to a “taking longer” fallback.',
      },
    },
  },
}

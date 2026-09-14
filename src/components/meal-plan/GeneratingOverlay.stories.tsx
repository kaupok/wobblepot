import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor } from 'storybook/test'
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

// Spinners are the one exemption from the reduced-motion override
// (docs/DESIGN.md → Motion, `globals.css`). Collapsed to a single 0.01ms turn
// like every other animation, the spinner would freeze and stop saying
// "loading". Forces the Storybook reduced-motion toolbar on and asserts the
// spinner still loops on its own cycle.
export const ReducedMotion: Story = {
  globals: {
    reducedMotion: 'on',
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true')
    })

    const spinner = canvasElement.querySelector('.animate-spin')
    expect(spinner).not.toBeNull()

    const style = window.getComputedStyle(spinner as Element)
    expect(style.animationIterationCount).toBe('infinite')
    expect(style.animationDuration).toBe('1s')
  },
}

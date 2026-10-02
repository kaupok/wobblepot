import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { Wordmark } from './wordmark'

const meta = {
  title: 'Feature/Navigation/Wordmark',
  component: Wordmark,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The Wobblepot wordmark, outlined from Bricolage Grotesque. The caller sets the height and the width follows. It fills with `currentColor`, so it takes the text colour of where it sits and switches with the theme. It is an image named "Wobblepot", so a link around it takes that name.',
      },
    },
  },
} satisfies Meta<typeof Wordmark>

export default meta
type Story = StoryObj<typeof meta>

/** The header size: 20px tall, about 104px wide. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const mark = within(canvasElement).getByRole('img', { name: 'Wobblepot' })
    const { height, width } = mark.getBoundingClientRect()
    await expect(Math.round(height)).toBe(20)
    // The width follows the height through the viewBox's aspect ratio.
    await expect(width / height).toBeCloseTo(4352 / 837, 1)
  },
}

/** Display size, for a landing page or a sign-in screen. */
export const Large: Story = {
  args: { className: 'h-16' },
}

/** On the inverted surface it takes the surface's foreground colour. */
export const OnPrimary: Story = {
  decorators: [
    (Story) => (
      <div className="bg-primary text-primary-foreground inline-block rounded-lg p-6">
        <Story />
      </div>
    ),
  ],
  args: { className: 'h-10' },
}

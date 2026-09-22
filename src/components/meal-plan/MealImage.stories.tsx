import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { MealImage } from './MealImage'

const meta = {
  title: 'Meal plan/MealImage',
  component: MealImage,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          "The hero illustration at the top of the meal detail modal (HON-737, HON-746). 2:1 and full-bleed: it cancels the dialog's `p-6` so it runs edge to edge with no radius of its own (HON-752). On the meal's tinted surface (`imageHue`), the image multiplied in so its white surface takes the tint, and the whole hero fading bottom-up into the dialog. Renders nothing without an image or without a hue; a plain box while it is generating (`docs/DESIGN.md` → Imagery).",
      },
    },
  },
  decorators: [
    // Stands in for `DialogContent` (bordered, `p-6`, clipping) so the bleed
    // through its padding is visible.
    (Story) => (
      <div className="bg-background w-96 overflow-hidden rounded-lg border p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    mealName: 'Lemon garlic chicken',
    status: 'ready',
    imageUrl: mealIllustration.src,
    imageHue: 52,
  },
} satisfies Meta<typeof MealImage>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const img = await within(canvasElement).findByRole('img', { name: 'Lemon garlic chicken' })
    await expect(img).toHaveAttribute('alt', 'Lemon garlic chicken')
    const hero = within(canvasElement).getByTestId('meal-image-hero')
    await expect(hero.style.getPropertyValue('--meal-hue')).toBe('52')
  },
}

export const ReadyDark: Story = {
  name: 'Ready (dark)',
  globals: { theme: 'dark' },
}

export const Hues: Story = {
  name: 'Three hues',
  render: (args) => (
    <div className="flex flex-col gap-4">
      {[52, 145, 264].map((hue) => (
        <MealImage key={hue} {...args} imageHue={hue} />
      ))}
    </div>
  ),
}

// A V3 image, or one whose extraction found no colour: no hue, no hero.
export const ReadyWithoutHue: Story = {
  name: 'Ready without a hue',
  args: { imageHue: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('img')).not.toBeInTheDocument()
  },
}

export const Generating: Story = {
  args: { status: 'generating', imageUrl: null, imageHue: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('img')).not.toBeInTheDocument()
    await expect(canvas.getByTestId('meal-image-placeholder')).toBeEmptyDOMElement()
  },
}

export const Absent: Story = {
  args: { status: 'none', imageUrl: null, imageHue: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('img')).not.toBeInTheDocument()
    await expect(canvas.queryByTestId('meal-image-placeholder')).not.toBeInTheDocument()
  },
}

export const Failed: Story = {
  args: { status: 'failed', imageUrl: null, imageHue: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('img')).not.toBeInTheDocument()
    await expect(canvas.queryByTestId('meal-image-placeholder')).not.toBeInTheDocument()
  },
}

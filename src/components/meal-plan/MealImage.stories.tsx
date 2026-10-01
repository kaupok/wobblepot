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
          "The hero illustration at the top of the cook view (HON-737, HON-746, HON-932). 3:2 across its column, edge to edge with no radius of its own, and never taller than 45% of the viewport. On the meal's tinted surface (`imageHue`), the image multiplied in so its white surface takes the tint, and the whole hero fading bottom-up into the panel. Without a hue the image sits on an untinted surface at the tint's lightness (HON-754); without an image it renders nothing, and a plain box while it is generating (`docs/DESIGN.md` → Imagery).",
      },
    },
  },
  decorators: [
    // Stands in for the cook view's column: no padding, clipping.
    (Story) => (
      <div className="bg-background w-96 overflow-hidden">
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
    // 3:2 across the full column (HON-932).
    await expect(hero.offsetWidth).toBe(384)
    await expect(Math.abs(hero.offsetWidth / hero.offsetHeight - 1.5)).toBeLessThanOrEqual(0.02)
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

// An image whose extraction found no colour: the hero keeps the image on an
// untinted surface at the tint's lightness (HON-754).
export const ReadyWithoutHue: Story = {
  name: 'Ready without a hue',
  args: { imageHue: null },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('img', { name: args.mealName })).toBeInTheDocument()
    const hero = canvas.getByTestId('meal-image-hero')
    await expect(hero).toHaveAttribute('data-meal-surface', 'neutral')
    await expect(hero.style.getPropertyValue('--meal-hue')).toBe('')
  },
}

export const ReadyWithoutHueDark: Story = {
  name: 'Ready without a hue (dark)',
  args: { imageHue: null },
  globals: { theme: 'dark' },
  play: async ({ canvasElement }) => {
    const hero = within(canvasElement).getByTestId('meal-image-hero')
    // The dark tint's lightness, not the near-black dialog background (HON-754).
    await expect(getComputedStyle(hero).backgroundColor).toBe('oklch(0.35 0 0)')
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

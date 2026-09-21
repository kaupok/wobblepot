import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import mealIllustration from '@/stories/assets/meal-illustration.jpg'
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
          'The hero illustration at the top of the meal detail modal (HON-737). 3:2, `rounded-lg`, fades in on load. Renders nothing without an image; a plain box while it is generating (`docs/DESIGN.md` → Imagery).',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
  args: {
    mealName: 'Lemon garlic chicken',
    status: 'ready',
    imageUrl: mealIllustration.src,
  },
} satisfies Meta<typeof MealImage>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const img = await within(canvasElement).findByRole('img', { name: 'Lemon garlic chicken' })
    await expect(img).toHaveAttribute('alt', 'Lemon garlic chicken')
  },
}

export const Generating: Story = {
  args: { status: 'generating', imageUrl: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('img')).not.toBeInTheDocument()
    await expect(canvas.getByTestId('meal-image-placeholder')).toBeEmptyDOMElement()
  },
}

export const Absent: Story = {
  args: { status: 'none', imageUrl: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('img')).not.toBeInTheDocument()
    await expect(canvas.queryByTestId('meal-image-placeholder')).not.toBeInTheDocument()
  },
}

export const Failed: Story = {
  args: { status: 'failed', imageUrl: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('img')).not.toBeInTheDocument()
    await expect(canvas.queryByTestId('meal-image-placeholder')).not.toBeInTheDocument()
  },
}

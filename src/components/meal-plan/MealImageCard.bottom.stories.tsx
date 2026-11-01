import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { CardContent, CardFooter } from '@/components/ui/card'
import { createMealCardBaseData, lemonGarlicChickenPantry } from '@/stories/fixtures'

import { MealCardBase, type MealCardBaseData } from './MealCardBase'
import { MealImageCard } from './MealImageCard'
import { withImage } from './MealImageCard.fixtures'

const meta = {
  title: 'Meal plan/MealImageCard/Bottom',
  component: MealImageCard,
  parameters: { layout: 'padded' },
  args: { meal: withImage(52), children: null },
} satisfies Meta<typeof MealImageCard>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A card taller than wide — the add-meal dialog's alternatives (HON-750). The
 * image is a 3:2 block below the content, fading upward, with the actions below
 * it; no text overlaps it and the title keeps the full row.
 */
function BottomCard({ meal, ...args }: React.ComponentProps<typeof MealImageCard>) {
  return (
    <MealImageCard
      {...args}
      meal={meal}
      layout="bottom"
      className="flex h-full w-68 flex-col"
      footer={
        <CardFooter className="p-4 pt-0">
          <Button className="w-full">Select</Button>
        </CardFooter>
      }
    >
      <CardContent className="flex-1 p-4 pb-2">
        <MealCardBase
          meal={meal as MealCardBaseData}
          pantryIngredients={lemonGarlicChickenPantry}
          nameHeadingTag="h3"
        />
      </CardContent>
    </MealImageCard>
  )
}

export const BottomWithImage: Story = {
  name: 'Bottom, with image',
  render: (args) => <BottomCard {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('img', { name: 'Lemon-garlic roast chicken' })
    const box = canvas.getByTestId('meal-card-image').getBoundingClientRect()
    const list = canvas.getByRole('list').getBoundingClientRect()
    const select = canvas.getByRole('button', { name: 'Select' }).getBoundingClientRect()
    // The content ends above the image and the button starts below it.
    await expect(list.bottom).toBeLessThanOrEqual(box.top)
    await expect(select.top).toBeGreaterThanOrEqual(box.bottom)
    // The whole 3:2 frame, full card width.
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    await expect(box.width).toBeCloseTo(card.clientWidth, 0)
    await expect(box.width / box.height).toBeCloseTo(1.5, 1)
    // Nothing sits beside the name, so it keeps the full row.
    const heading = canvas.getByRole('heading', { name: 'Lemon-garlic roast chicken' })
    await expect(getComputedStyle(heading.parentElement!).maxWidth).toBe('none')
  },
}

export const BottomWithImageDark: Story = {
  name: 'Bottom, with image (dark)',
  globals: { theme: 'dark' },
  render: (args) => <BottomCard {...args} />,
}

export const BottomWithoutImage: Story = {
  name: 'Bottom, without image',
  args: { meal: createMealCardBaseData() },
  render: (args) => <BottomCard {...args} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('meal-card-image')).not.toBeInTheDocument()
    await expect(within(canvasElement).getByRole('button', { name: 'Select' })).toBeInTheDocument()
  },
}

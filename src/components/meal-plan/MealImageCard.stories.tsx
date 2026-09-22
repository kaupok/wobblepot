import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { CardContent } from '@/components/ui/card'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { createMealCardBaseData, lemonGarlicChickenPantry } from '@/stories/fixtures'
import { MealCardBase, type MealCardBaseData } from './MealCardBase'
import { MealImageCard } from './MealImageCard'

const withImage = (hue: number, overrides: Partial<MealCardBaseData> = {}) =>
  createMealCardBaseData({
    imageStatus: 'ready',
    imageUrl: mealIllustration.src,
    imageHue: hue,
    ...overrides,
  })

const meta = {
  title: 'Meal plan/MealImageCard',
  component: MealImageCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "The card every `MealCardBase` callsite (and the planner's `MealCard`) wraps its content in (HON-746, `docs/DESIGN.md` → Imagery). With a `ready` image and an `imageHue`, the card takes the meal's tint and the illustration blends into its right 5/8 — multiplied, so the white surface takes the tint, and fading in from the left. Without one it is the plain `Card`: no tint, no image, nothing reserved while generating.",
      },
    },
  },
  args: {
    meal: withImage(52),
    className: 'max-w-md',
    children: null,
  },
  render: ({ meal, ...args }) => (
    <MealImageCard {...args} meal={meal}>
      <CardContent className="p-4">
        <MealCardBase
          meal={meal as MealCardBaseData}
          pantryIngredients={lemonGarlicChickenPantry}
        />
      </CardContent>
    </MealImageCard>
  ),
} satisfies Meta<typeof MealImageCard>

export default meta
type Story = StoryObj<typeof meta>

export const WithImage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const img = await canvas.findByRole('img', { name: 'Lemon-garlic roast chicken' })
    await expect(img).toHaveClass('object-cover')
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    await expect(card.style.getPropertyValue('--meal-hue')).toBe('52')
    // The tint is on the card itself, so the background is no longer the neutral --card.
    await expect(getComputedStyle(card).backgroundColor).not.toBe('rgb(255, 255, 255)')
  },
}

export const WithImageDark: Story = {
  name: 'With image (dark)',
  globals: { theme: 'dark' },
}

export const WithoutImage: Story = {
  args: { meal: createMealCardBaseData() },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('img')).not.toBeInTheDocument()
    const card = canvasElement.querySelector('[data-slot="card"]')!
    await expect(card).not.toHaveAttribute('data-meal-surface')
  },
}

// Cards show nothing extra while the image is drawn: no box, no skeleton.
export const Generating: Story = {
  args: { meal: createMealCardBaseData({ imageStatus: 'generating' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('img')).not.toBeInTheDocument()
    await expect(within(canvasElement).queryByTestId('meal-card-image')).not.toBeInTheDocument()
  },
}

const HUES = [
  { hue: 52, name: 'Lemon-garlic roast chicken' },
  { hue: 145, name: 'Pea and mint risotto' },
  { hue: 264, name: 'Blueberry overnight oats' },
]

function Hues({ meal: _meal, ...args }: React.ComponentProps<typeof MealImageCard>) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {HUES.map(({ hue, name }) => {
        const meal = withImage(hue, { name })
        return (
          <MealImageCard key={hue} {...args} meal={meal} className="h-full">
            <CardContent className="p-4">
              <MealCardBase meal={meal} pantryIngredients={lemonGarlicChickenPantry} />
            </CardContent>
          </MealImageCard>
        )
      })}
      <MealImageCard {...args} meal={createMealCardBaseData()} className="h-full">
        <CardContent className="p-4">
          <MealCardBase meal={createMealCardBaseData({ name: 'No image yet' })} />
        </CardContent>
      </MealImageCard>
    </div>
  )
}

/** Three hues beside a card without an image: only the hue differs, never the contrast. */
export const AllVariants: Story = {
  parameters: { layout: 'fullscreen' },
  render: (args) => (
    <div className="p-4">
      <Hues {...args} />
    </div>
  ),
}

export const AllVariantsDark: Story = {
  name: 'All variants (dark)',
  parameters: { layout: 'fullscreen' },
  globals: { theme: 'dark' },
  render: (args) => (
    <div className="bg-background p-4">
      <Hues {...args} />
    </div>
  ),
}

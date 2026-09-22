import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { MoreHorizontal, NotebookPen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { createMealCardBaseData, lemonGarlicChickenPantry } from '@/stories/fixtures'
import { MealCardBase, type MealCardBaseData } from './MealCardBase'
import { MealImageCard, mealImageTitleWidth } from './MealImageCard'

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
          "The card every `MealCardBase` callsite (and the planner's `MealCard`) wraps its content in (HON-746, `docs/DESIGN.md` → Imagery). With a `ready` image and an `imageHue`, the card takes the meal's tint and the illustration blends into its right 5/8 (45% on a phone) — multiplied, so the white surface takes the tint, and fading in from the left. Without one it is the plain `Card`: no tint, no image, nothing reserved while generating. With `trailingActions` (the planner card's Note and menu) the image ends before the action column, so nothing the user taps sits on it (HON-749). With `layout=\"bottom\"` (cards taller than wide, like the add-meal dialog's alternatives) the image is a full-width 3:2 block below the content, fading upward, with `footer` below it (HON-750).",
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
    // The name wraps before the opaque image (HON-749).
    const box = canvas.getByTestId('meal-card-image').getBoundingClientRect()
    const heading = canvas.getByRole('heading', { name: 'Lemon-garlic roast chicken' })
    await expect(heading.getBoundingClientRect().right).toBeLessThanOrEqual(
      box.left + box.width * 0.3,
    )
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
    // A neutral card gives the name the full width.
    const heading = within(canvasElement).getByRole('heading')
    await expect(getComputedStyle(heading.parentElement!).maxWidth).toBe('none')
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

const LONG_TITLE = 'Baked Salmon with Asparagus'

/**
 * The planner card's title row: a long name and the Note / menu action column
 * (HON-749). The image ends before the actions, and the title wraps before the
 * image, so both sit on the plain tint. Mirrors `MealCard`'s header markup.
 */
function TrailingActionsCard({ meal, ...args }: React.ComponentProps<typeof MealImageCard>) {
  return (
    <MealImageCard {...args} meal={meal} trailingActions className="gap-2 py-2">
      <CardHeader className="px-3 pb-0">
        <div className="flex items-start justify-between gap-1">
          <div className={cn('min-w-0', mealImageTitleWidth(true))}>
            <Body variant="small" className="font-semibold">
              <button type="button" className="min-h-8 text-left leading-snug">
                {meal.name}
              </button>
            </Body>
          </div>
          <div data-testid="card-actions" className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm">
              <NotebookPen aria-hidden="true" />
              Note
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </div>
        </div>
        <Body variant="caption">All ingredients in pantry</Body>
      </CardHeader>
    </MealImageCard>
  )
}

/**
 * Asserts that the actions and the title clear the image's opaque part: the
 * actions start at or after the image box's right edge, and the title ends
 * inside the left fade (the first 30% of the box).
 */
async function assertOnTint(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await canvas.findByRole('img', { name: LONG_TITLE })
  const box = canvas.getByTestId('meal-card-image').getBoundingClientRect()
  const actions = canvas.getByTestId('card-actions').getBoundingClientRect()
  const title = canvas.getByRole('button', { name: LONG_TITLE }).getBoundingClientRect()
  await expect(box.width).toBeGreaterThan(0)
  await expect(actions.left).toBeGreaterThanOrEqual(box.right)
  await expect(title.right).toBeLessThanOrEqual(box.left + box.width * 0.3)
}

export const TrailingActionsPhone: Story = {
  name: 'Trailing actions, long title (phone)',
  args: { meal: withImage(28, { name: LONG_TITLE }), className: undefined },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  render: (args) => <TrailingActionsCard {...args} />,
  play: async ({ canvasElement }) => assertOnTint(canvasElement),
}

export const TrailingActionsDesktop: Story = {
  name: 'Trailing actions, long title (desktop)',
  args: { meal: withImage(28, { name: LONG_TITLE }), className: undefined },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: { layout: 'fullscreen' },
  render: (args) => (
    <div className="max-w-3xl p-4">
      <TrailingActionsCard {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => assertOnTint(canvasElement),
}

/** An image that fails to load leaves a neutral card, and the title its full row. */
export const TrailingActionsBrokenImage: Story = {
  name: 'Trailing actions, broken image',
  args: {
    meal: withImage(28, { name: LONG_TITLE, imageUrl: '/missing-meal-image.png' }),
    className: undefined,
  },
  render: (args) => <TrailingActionsCard {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.queryByTestId('meal-card-image')).not.toBeInTheDocument())
    const card = canvasElement.querySelector('[data-slot="card"]')!
    await expect(card).not.toHaveAttribute('data-meal-surface')
    const titleWrapper = canvas.getByRole('button', { name: LONG_TITLE }).closest('div')!
    await expect(getComputedStyle(titleWrapper).maxWidth).toBe('none')
  },
}

/**
 * The alternatives grid: ~250px cards on a desktop screen. The geometry follows
 * the card's width (a container query), so these get the narrow layout — the
 * name keeps half the row rather than 3/8 of it.
 */
export const NarrowGridDesktop: Story = {
  name: 'Narrow grid (desktop)',
  globals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: { layout: 'fullscreen' },
  render: (args) => (
    <div className="grid max-w-3xl grid-cols-3 gap-3 p-4">
      {HUES.map(({ hue, name }) => {
        const meal = withImage(hue, { name })
        return (
          <MealImageCard key={hue} {...args} meal={meal} className="h-full">
            <CardContent className="p-4">
              <MealCardBase meal={meal} />
            </CardContent>
          </MealImageCard>
        )
      })}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findAllByRole('img')
    const cards = canvasElement.querySelectorAll<HTMLElement>('[data-slot="card"]')
    for (const card of cards) {
      const box = within(card).getByTestId('meal-card-image').getBoundingClientRect()
      const wrapper = within(card).getByRole('heading').parentElement!
      const content = wrapper.parentElement!.getBoundingClientRect().width
      // Half the content row: the narrow geometry, not the viewport's `sm` one.
      await expect(wrapper.getBoundingClientRect().width).toBeCloseTo(content / 2, 0)
      await expect(box.width).toBeCloseTo(card.clientWidth * 0.45, 0)
    }
  },
}

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

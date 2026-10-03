import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { MoreHorizontal } from 'lucide-react'
import { MealType, ProteinType } from '@/generated/prisma/enums'
import { Button } from '@/components/ui/button'
import { CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Body, Heading } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { createMealCardBaseData, lemonGarlicChickenPantry } from '@/stories/fixtures'
import { MealCardBase, type MealCardBaseData } from './MealCardBase'
import { MealImageCard, mealImageTitleWidth } from './MealImageCard'
import { MealTypeBadge } from './MealTypeBadge'
import { ProteinBadge } from './ProteinBadge'
import { StickyNote } from './StickyNote'

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
          "The card every `MealCardBase` callsite (and the planner's `MealCard`) wraps its content in (HON-746, `docs/DESIGN.md` → Imagery). With a `ready` image and an `imageHue`, the card takes the meal's tint and the illustration blends into its right 5/8 (45% on a phone) — multiplied, so the white surface takes the tint, and fading in from the left. Without an image it is the plain `Card`: no tint, no image, nothing reserved while generating. With an image but no hue, the image stays on an untinted surface at the tint's lightness (HON-754). With `trailingActions` (the planner card's Note and menu) the image ends before the action column, so nothing the user taps sits on it (HON-749). With `head` (the planner card) the image runs from the card's top edge to the bottom of the head, and the children are the full-width rows below it, on the plain tint (HON-927). With `layout=\"bottom\"` (cards taller than wide, like the add-meal dialog's alternatives) the image is a full-width 3:2 block below the content, fading upward, with `footer` below it (HON-750).",
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
    await expect(getComputedStyle(card).backgroundColor).not.toBe('oklch(1 0 0)')
    // The name wraps before the opaque image (HON-749).
    const box = canvas.getByTestId('meal-card-image').getBoundingClientRect()
    const heading = canvas.getByRole('heading', { name: 'Lemon-garlic roast chicken' })
    await expect(heading.getBoundingClientRect().right).toBeLessThanOrEqual(
      box.left + box.width * 0.3,
    )
  },
}

/**
 * `interactive` (the `Card` variant): a click anywhere opens the card, as on
 * the planner card (HON-1010). The pointer cursor is the card's; the hover
 * border and the focus ring of the `card-target` are covered in `UI/Card`.
 * On the tint the hover edge is the meal's chip colour, the badge's (HON-1027).
 */
export const Interactive: Story = {
  args: { interactive: true },
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    await expect(getComputedStyle(card).cursor).toBe('pointer')
    await expect(card).toHaveClass('group/card')
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

// An image whose extraction found no colour: the image stays, on the neutral
// card (HON-754). A generated picture is never hidden by its colour.
export const WithImageWithoutHue: Story = {
  name: 'With image, without a hue',
  args: { meal: withImage(0, { imageHue: null }) },
  play: async ({ canvasElement }) => {
    const img = await within(canvasElement).findByRole('img', {
      name: 'Lemon-garlic roast chicken',
    })
    await expect(img).toBeInTheDocument()
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    await expect(card).toHaveAttribute('data-meal-surface', 'neutral')
    await expect(card.style.getPropertyValue('--meal-hue')).toBe('')
    // The tint's lightness at zero chroma, not an invalid oklch() (transparent).
    await expect(getComputedStyle(card).backgroundColor).toBe('oklch(0.97 0 0)')
  },
}

export const WithImageWithoutHueDark: Story = {
  name: 'With image, without a hue (dark)',
  args: { meal: withImage(0, { imageHue: null }) },
  globals: { theme: 'dark' },
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    // The dark tint's lightness, not the darker neutral --card (HON-754).
    await expect(getComputedStyle(card).backgroundColor).toBe('oklch(0.35 0 0)')
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
 * The planner card's header: the slot badge with the menu at the right end
 * of its row, then a long name on its own row (HON-749). The image ends
 * before the menu, and the title wraps before the image, so both sit on the
 * plain tint. Mirrors `MealCard`'s header markup.
 */
function TrailingActionsCard({ meal, ...args }: React.ComponentProps<typeof MealImageCard>) {
  return (
    <MealImageCard {...args} meal={meal} trailingActions size="sm">
      <TrailingActionsHeader name={meal.name}>
        <Body variant="caption">All ingredients in pantry</Body>
      </TrailingActionsHeader>
    </MealImageCard>
  )
}

function TrailingActionsHeader({ name, children }: { name: string; children?: React.ReactNode }) {
  return (
    <CardHeader className="px-4 pt-1 pb-1">
      <div className="flex min-h-8 items-center justify-between gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <MealTypeBadge mealType={MealType.dinner} />
          <ProteinBadge proteinType={ProteinType.fish} />
        </div>
        <div data-testid="card-actions" className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="More actions">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className={cn('min-w-0', mealImageTitleWidth(true))}>
        <Heading variant="section" as="h3">
          <button type="button" className="min-h-8 text-left leading-snug">
            {name}
          </button>
        </Heading>
      </div>
      {children}
    </CardHeader>
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

/**
 * `head` (HON-927): the image runs from the card's top edge to the first row
 * below the head, so that row sits on the tint, and the plate keeps the
 * head's height rather than a fixed band.
 */
export const HeadWithRowBelow: Story = {
  name: 'Head with a row below',
  args: { meal: withImage(28, { name: LONG_TITLE }), className: undefined },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  render: ({ meal, ...args }) => (
    <MealImageCard
      {...args}
      meal={meal}
      trailingActions
      size="sm"
      head={<TrailingActionsHeader name={meal.name} />}
    >
      <CardContent className="px-4 pb-2">
        <Body variant="caption">All ingredients in pantry</Body>
      </CardContent>
    </MealImageCard>
  ),
  play: async ({ canvasElement }) => {
    await assertOnTint(canvasElement)
    const canvas = within(canvasElement)
    const box = canvas.getByTestId('meal-card-image').getBoundingClientRect()
    const card = canvasElement.querySelector('[data-slot="card"]')!
    const row = canvasElement.querySelector('[data-slot="card-content"]')!.getBoundingClientRect()
    const caption = canvas.getByText('All ingredients in pantry').getBoundingClientRect()
    // From the card's top edge (inside its 1px border) to the row below the head.
    await expect(box.top).toBeCloseTo(card.getBoundingClientRect().top + card.clientTop, 0)
    await expect(box.bottom).toBeCloseTo(row.top, 0)
    await expect(caption.top).toBeGreaterThanOrEqual(box.bottom)
  },
}

/**
 * `overlay` (HON-974): laid over the head's bottom-right corner, on the plate,
 * rather than added as a row. The image keeps the card's full height, and the
 * overlay stays clear of the title and the action column.
 */
export const HeadWithOverlay: Story = {
  name: 'Head with an overlay',
  args: { meal: withImage(28, { name: LONG_TITLE }), className: undefined },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  render: ({ meal, ...args }) => (
    <MealImageCard
      {...args}
      meal={meal}
      trailingActions
      size="sm"
      head={<TrailingActionsHeader name={meal.name} />}
      overlay={
        <StickyNote>
          <Body variant="paragraph">Double the garlic.</Body>
        </StickyNote>
      }
    />
  ),
  play: async ({ canvasElement }) => {
    await assertOnTint(canvasElement)
    // The fallback font sets wider; measure once the web font has landed.
    await document.fonts.ready
    const canvas = within(canvasElement)
    const card = canvasElement.querySelector('[data-slot="card"]')!
    const cardBox = card.getBoundingClientRect()
    const box = canvas.getByTestId('meal-card-image').getBoundingClientRect()
    const slip = canvas.getByText('Double the garlic.').closest('[data-surface="sticky"]')!
    const slipBox = slip.getBoundingClientRect()
    const title = canvas.getByRole('button', { name: LONG_TITLE }).getBoundingClientRect()
    const actions = canvas.getByTestId('card-actions').getBoundingClientRect()
    // The plate runs to the card's bottom edge (inside its border): no row ends it.
    await expect(box.bottom).toBeCloseTo(cardBox.bottom - card.clientTop, 0)
    await expect(slipBox.bottom).toBeLessThanOrEqual(cardBox.bottom)
    await expect(slipBox.left).toBeGreaterThanOrEqual(title.right)
    await expect(slipBox.right).toBeLessThanOrEqual(actions.left)
  },
}

/**
 * `overlayPlacement` (HON-975): the overlay rests at its own offset and tilt
 * from the corner, and lies wherever a saved place puts it, at the same width.
 */
export const HeadWithPlacedOverlay: Story = {
  name: 'Head with a scattered and a placed overlay',
  args: { meal: withImage(28, { name: LONG_TITLE }), className: undefined },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  render: ({ meal, ...args }) => (
    <div className="flex flex-col gap-4">
      {[null, { x: 0.05, y: 0.55 }].map((position) => (
        <MealImageCard
          key={position ? 'placed' : 'scattered'}
          {...args}
          meal={meal}
          trailingActions
          size="sm"
          head={<TrailingActionsHeader name={meal.name} />}
          overlay={
            <StickyNote>
              <Body variant="paragraph">Double the garlic.</Body>
            </StickyNote>
          }
          overlayPlacement={{ scatter: { x: -6, y: -4, tilt: 2.5 }, position }}
        />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    await document.fonts.ready
    const overlays = canvasElement.querySelectorAll<HTMLElement>('[data-slot="meal-image-overlay"]')
    const scattered = overlays[0]!
    const placed = overlays[1]!
    await expect(scattered).not.toHaveAttribute('data-placed')
    await expect(getComputedStyle(scattered).translate).toBe('-6px -4px')
    await expect(placed).toHaveAttribute('data-placed')
    // The tilt reaches the slip through the custom property.
    const slip = placed.querySelector<HTMLElement>('[data-surface="sticky"]')!
    await expect(getComputedStyle(slip).rotate).toBe('2.5deg')
    // The placed slip keeps the width it had in the corner.
    await expect(placed.getBoundingClientRect().width).toBeCloseTo(
      scattered.getBoundingClientRect().width,
      0,
    )
  },
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

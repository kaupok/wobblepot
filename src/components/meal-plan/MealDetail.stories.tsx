import { useState, type ComponentProps } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  createMeal,
  lemonGarlicChickenComponentsFull,
  lemonGarlicChickenPantryWithOil,
} from '@/stories/fixtures'
import { expectSingleLine, expectWithinHorizontally } from '@/stories/layout-helpers'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/typography'
import { MealDetail } from './MealDetail'
import { MealImage } from './MealImage'
import type { PantryIngredient, StructuredTips } from './types'

const mealFixture = createMeal({ components: lemonGarlicChickenComponentsFull })

const tips: StructuredTips = {
  equipment: ['Sheet pan', 'Sharp knife', 'Tongs'],
  steps: [
    'Heat oven to 220°C.',
    'Season chicken with salt, pepper and olive oil.',
    'Arrange on sheet pan with lemon halves and smashed garlic.',
    'Roast 35 min until golden and juices run clear.',
  ],
  pitfalls: ['Don’t crowd the pan.', 'Rest 5 minutes before slicing.'],
  tip: 'Deglaze the pan with a splash of wine to make a quick sauce.',
}

const meta = {
  title: 'Meal plan/MealDetail',
  component: MealDetail,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The cook view’s content (HON-932), outside its dialog. Below `lg` one scrolling column: hero, title, meta, note, ingredients, nutrition, “You’ll need”, steps, so “Done cooking” ends it (HON-965). From `lg` two columns that scroll on their own: the title down to nutrition on the left, the hero, “You’ll need” and the steps on the right (HON-966). `MealDetailModal` supplies the hero, title, title actions and note through slots.',
      },
    },
  },
  args: {
    meal: mealFixture,
    householdServings: 4,
    title: <Heading variant="display">{mealFixture.name}</Heading>,
  },
  decorators: [
    // A fixed height like the cook view's panel, so the columns scroll.
    (Story) => (
      <div className="bg-card h-dvh">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MealDetail>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The badge row, the meal’s facts in one form (HON-1025): the Kid-friendly icon pill, its label in a tooltip and in `sr-only` text, as on the cards (HON-1023); the time as the cards’ `surface` badge with a clock (HON-951); then Serves, a `surface` badge that is a button. All at the cook view’s `lg` size.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const time = canvas.getByText('45 min').closest<HTMLElement>('[data-slot="badge"]')!
    await expect(time).toHaveAttribute('data-variant', 'surface')
    await expect(time.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    const kidFriendly = canvas
      .getByText('Kid-friendly')
      .closest<HTMLElement>('[data-slot="badge"]')!
    const serves = canvas.getByText('Serves 4').closest<HTMLElement>('[data-slot="badge"]')!
    // Left to right: Kid-friendly, the time, Serves.
    await expect(
      Array.from(canvas.getByTestId('cook-view-badges').querySelectorAll('[data-slot="badge"]')),
    ).toEqual([kidFriendly, time, serves])
    // All `lg`: the same height, on the same line.
    for (const badge of [time, serves]) {
      await expect(badge.offsetHeight).toBe(kidFriendly.offsetHeight)
      await expect(badge.offsetTop).toBe(kidFriendly.offsetTop)
    }
    // The icon alone: the label is for screen readers and the tooltip.
    await expect(canvas.getByText('Kid-friendly')).toHaveClass('sr-only')
    await userEvent.hover(kidFriendly)
    const tooltip = await within(document.body).findByRole('tooltip')
    await expect(tooltip).toHaveTextContent('Kid-friendly')
  },
}

export const ZeroMinutes: Story = {
  name: 'No prep time',
  args: { meal: createMeal({ components: lemonGarlicChickenComponentsFull, timeMinutes: 0 }) },
  parameters: {
    docs: {
      description: {
        story:
          'A meal with no time, or 0 minutes, shows no time badge: the Kid-friendly icon pill, then Serves (HON-711, HON-951, HON-1025).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Kid-friendly').closest('[data-slot="badge"]')).toBeVisible()
    await expect(canvas.queryByText(/^\d+ min$/)).toBeNull()
    // No stray "0" where the badge would be (HON-711).
    await expect(canvas.getByTestId('cook-view-badges').textContent).toBe('Kid-friendlyServes 4')
  },
}

export const ServesOnly: Story = {
  name: 'No time, not kid-friendly',
  args: {
    meal: createMeal({
      components: lemonGarlicChickenComponentsFull,
      timeMinutes: null,
      kidFriendly: false,
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'The badge row always renders, because Serves is always there (HON-1025). With no time and no kid-friendly flag, Serves is the only badge.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByTestId('cook-view-badges')
    await expect(row.querySelectorAll('[data-slot="badge"]')).toHaveLength(1)
    await expect(row).toHaveTextContent(/^Serves 4$/)
  },
}

export const OwnRecipe: Story = {
  name: 'Own recipe',
  args: { meal: createMeal({ components: lemonGarlicChickenComponentsFull, isCustom: true }) },
  parameters: {
    docs: {
      description: {
        story:
          'One of the household’s own recipes: the badge row carries no “My recipe” pill. `MealDetailModal` puts the `MyRecipeIcon` after the meal name in the title, as the cards do (HON-1023).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText('My recipe')).toBeNull()
    // Kid-friendly, the time and Serves.
    const row = canvas.getByTestId('cook-view-badges')
    await expect(row.querySelectorAll('[data-slot="badge"]')).toHaveLength(3)
  },
}

export const WithDescription: Story = {
  args: {
    meal: createMeal({
      description: 'Lemon-garlic roast chicken with crisp potatoes and a bright pan sauce.',
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Seeded meals carry a description (a localized `MealTranslation` field). It renders as muted body text under the title.',
      },
    },
  },
}

export const WithTitleActions: Story = {
  args: {
    meal: createMeal({
      description: 'Lemon-garlic roast chicken with crisp potatoes and a bright pan sauce.',
    }),
    titleActions: (
      <Button variant="ghost" size="icon-lg" aria-label={`More actions: ${mealFixture.name}`}>
        <MoreHorizontal aria-hidden="true" />
      </Button>
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Actions on the meal sit at the right end of the title row, beside the name (HON-966). `MealDetailModal` passes its ⋯ menu here; the name wraps before it reaches the button.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole('heading', { name: mealFixture.name })
    const actions = canvas.getByRole('button', { name: `More actions: ${mealFixture.name}` })
    const titleBox = title.getBoundingClientRect()
    const actionsBox = actions.getBoundingClientRect()
    // Same row, to the right of the name, and 44px.
    await expect(actionsBox.top).toBeLessThan(titleBox.bottom)
    await expect(actionsBox.left).toBeGreaterThanOrEqual(titleBox.right)
    await expect(actionsBox.height).toBeGreaterThanOrEqual(44)
  },
}

export const WithImage: Story = {
  args: {
    meal: createMeal({
      description: 'Lemon-garlic roast chicken with crisp potatoes and a bright pan sauce.',
    }),
    image: (
      <MealImage
        mealName="Lemon garlic chicken"
        status="ready"
        imageUrl={mealIllustration.src}
        imageHue={52}
      />
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          'The hero illustration (HON-737). Below `lg` it is the first thing on screen, above the title and the description; from `lg` it tops the steps column (HON-966). It sits in the steps column in the DOM either way. `MealDetailModal` supplies it through the `image` slot.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const img = await canvas.findByRole('img', { name: 'Lemon garlic chicken' })
    await expect(canvas.getByTestId('cook-view-steps')).toContainElement(img)
    // Below `lg`, still above the title and the description.
    const title = canvas.getByRole('heading', { name: mealFixture.name })
    await expect(img.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      title.getBoundingClientRect().top,
    )
  },
}

export const LocalizedContent: Story = {
  args: {
    meal: createMeal({
      name: 'Kanakarri',
      description: 'Kreemjas kanakarri aromaatsete vürtsidega.',
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Estonian household: the API pre-translates the meal name + description (HON-547), so the detail view renders Estonian seeded content.',
      },
    },
  },
}

export const WithPantry: Story = {
  args: { pantryIngredients: lemonGarlicChickenPantryWithOil },
}

const staplesOnlyPantry: PantryIngredient[] = [
  { ingredientId: 'garlic', isStaple: true },
  { ingredientId: 'olive-oil', isStaple: true },
  { ingredientId: 'salt', isStaple: true },
]

/** Ingredient rows styled as missing (`Li` with the warning tone). */
function missingRows(canvasElement: HTMLElement): HTMLElement[] {
  return within(canvasElement)
    .getAllByRole('listitem')
    .filter((row) => row.classList.contains('text-warning'))
}

export const StaplesOnlyPantry: Story = {
  args: {
    pantryIngredients: staplesOnlyPantry,
    onToggleAvailability: fn(),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Every household starts with salt, black pepper and water as staples (HON-769). A pantry holding only staples says nothing yet: the checkboxes stay, because they are how the user starts filling the pantry, but there is no status after the heading and no row is marked missing (HON-824).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('checkbox')).toHaveLength(3)
    await expect(canvas.queryByText(/to buy|all at home/i)).toBeNull()
    await expect(missingRows(canvasElement)).toHaveLength(0)
  },
}

/**
 * Holds the pantry in state so a tick adds the ingredient, as the refresh after
 * `MealDetailModal`'s toggle does.
 */
function StaplesOnlyPantryTickRender(args: ComponentProps<typeof MealDetail>) {
  const [pantry, setPantry] = useState(staplesOnlyPantry)
  return (
    <MealDetail
      {...args}
      pantryIngredients={pantry}
      onToggleAvailability={(ingredientId, hasIt) => {
        args.onToggleAvailability?.(ingredientId, hasIt)
        setPantry((prev) =>
          hasIt
            ? [...prev, { ingredientId, isStaple: false }]
            : prev.filter((p) => p.ingredientId !== ingredientId),
        )
      }}
    />
  )
}

export const StaplesOnlyPantryTick: Story = {
  name: 'Staples-only pantry, first tick',
  args: { onToggleAvailability: fn() },
  render: StaplesOnlyPantryTickRender,
  parameters: {
    docs: {
      description: {
        story:
          'Ticking the first ingredient gives the pantry data, so the status and the missing styling appear for the rest (HON-824).',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText(/to buy/i)).toBeNull()

    await userEvent.click(canvas.getByRole('checkbox', { name: 'Mark Chicken thigh as available' }))

    await expect(args.onToggleAvailability).toHaveBeenCalledWith('chicken-thigh', true)
    await expect(await canvas.findByText('2 to buy')).toBeInTheDocument()
    await expect(missingRows(canvasElement).map((row) => row.textContent)).toEqual([
      expect.stringContaining('Potato'),
      expect.stringContaining('Lemon'),
    ])
  },
}

/** Each badge's left edge, and the row's height. */
function badgeRowGeometry(row: HTMLElement): { lefts: number[]; height: number } {
  const badges = Array.from(row.querySelectorAll<HTMLElement>('[data-slot="badge"]'))
  return {
    lefts: badges.slice(0, -1).map((badge) => badge.getBoundingClientRect().left),
    height: row.getBoundingClientRect().height,
  }
}

export const WithServingControl: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    servings: 4,
    onServingsChange: fn(async () => true),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Serves is the last badge in the row (HON-1025). Its field opens in place of the badge at the same height, so the row does not grow and the badges before it do not move. Enter saves; Escape cancels.',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByTestId('cook-view-badges')
    const before = badgeRowGeometry(row)

    await userEvent.click(canvas.getByRole('button', { name: 'Serves 4. Click to edit.' }))
    const input = canvas.getByRole('textbox', { name: 'Number of servings' })
    await expect(row).toContainElement(input)
    await expect(badgeRowGeometry(row)).toEqual(before)

    await userEvent.keyboard('{Escape}')
    await expect(canvas.getByRole('button', { name: 'Serves 4. Click to edit.' })).toBeVisible()
    await expect(args.onServingsChange).not.toHaveBeenCalled()

    await userEvent.click(canvas.getByRole('button', { name: 'Serves 4. Click to edit.' }))
    await userEvent.clear(canvas.getByRole('textbox', { name: 'Number of servings' }))
    await userEvent.keyboard('6{Enter}')
    await expect(args.onServingsChange).toHaveBeenCalledWith(6)
  },
}

export const Completed: Story = {
  args: {
    status: 'completed',
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    servings: 6,
    onServingsChange: fn(async () => true),
    hideAvailability: true,
    hideAvailabilityBadge: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'A completed entry’s servings are what the pantry was charged for, so the API refuses to change them (HON-652). The count renders as a static `surface` badge in the badge row, with no pencil, instead of the serving control (HON-1025).',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const serves = canvas.getByText('Serves 6')
    await expect(serves).toHaveAttribute('data-slot', 'badge')
    await expect(serves.querySelector('svg')).toBeNull()
    await expect(canvas.getByRole('heading', { name: 'Ingredients' })).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /serves 6/i })).toBeNull()
    await expect(canvas.queryByLabelText('Number of servings')).toBeNull()
    await expect(args.onServingsChange).not.toHaveBeenCalled()
  },
}

/** Whether `b` comes after `a` in document order. */
function follows(a: Node, b: Node): boolean {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

export const TipsCollapsed: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    onHowToPrepare: fn(),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Before tips are asked for, the steps area is its heading and a primary "How to prepare" button, full width on a phone (HON-932; generated on open in HON-933).',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByTestId('cook-view-steps-body')
    const button = within(steps).getByRole('button', { name: 'How to prepare' })
    await expect(within(steps).getByRole('heading', { name: 'Steps' })).toBeVisible()
    // Ingredients, then the steps area.
    await expect(follows(canvas.getByRole('heading', { name: /^Ingredients/ }), steps)).toBe(true)
    // 44px+ and the column's full width below `md`.
    await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    await expect(button.offsetWidth).toBe(
      steps.clientWidth -
        Number.parseFloat(getComputedStyle(steps).paddingLeft) -
        Number.parseFloat(getComputedStyle(steps).paddingRight),
    )

    await userEvent.click(button)
    await expect(args.onHowToPrepare).toHaveBeenCalledOnce()
  },
}

export const TipsExpanded: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    tips,
    isTipsExpanded: true,
    onHowToPrepare: fn(),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Loaded tips: the equipment as a "You’ll need" list at the top of the steps area, directly above "Steps" (HON-966), then the numbered steps, Watch out and Tip, at the step size.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByTestId('cook-view-steps')
    await expect(within(steps).getByText(tips.steps![0]!)).toBeVisible()
    await expect(within(steps).getByRole('heading', { name: 'Watch out' })).toBeVisible()
    await expect(within(steps).getByRole('heading', { name: 'Tip' })).toBeVisible()
    await expect(within(steps).queryByRole('button', { name: 'How to prepare' })).toBeNull()
    // The equipment tops the steps area, directly above "Steps", after the
    // ingredients.
    const equipment = within(steps).getByRole('list', { name: "You'll need" })
    await expect(follows(canvas.getByRole('heading', { name: /^Ingredients/ }), equipment)).toBe(
      true,
    )
    await expect(follows(equipment, within(steps).getByRole('heading', { name: 'Steps' }))).toBe(
      true,
    )
  },
}

export const TipsLoading: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    isLoadingTips: true,
    isTipsExpanded: true,
    onHowToPrepare: fn(),
  },
}

export const TipsError: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    tipsError: 'Failed to load tips.',
    isTipsExpanded: true,
    onHowToPrepare: fn(),
    onRetryTips: fn(),
  },
}

export const WithPreparationNotes: Story = {
  args: {
    meal: createMeal({
      components: lemonGarlicChickenComponentsFull,
      preparationNotes: 'Add extra thyme. Kids prefer the skin crispy — broil last 2 min.',
    }),
    tips,
    isTipsExpanded: true,
    onHowToPrepare: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The household's own notes come first; the generated steps supplement them.
    await expect(
      follows(
        canvas.getByRole('heading', { name: 'Your notes' }),
        canvas.getByText(tips.steps![0]!),
      ),
    ).toBe(true)
  },
}

export const HideAvailability: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    hideAvailability: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'For completed/skipped meals — hides checkboxes and missing-ingredient styling.',
      },
    },
  },
}

// The ingredients column at its narrowest, ~340px: a 390px phone less the
// view's `px-5`, and the left 2/5 of the cook view at 1024px less its `px-6`
// (HON-932). A 380px frame less `px-5` gives it. The header used to fragment
// and squeeze the badge at this sort of width (HON-692).
const narrowColumnDecorator: NonNullable<Story['decorators']> = [
  (Story) => (
    <div className="bg-card h-dvh w-95">
      <Story />
    </div>
  ),
]

const narrowColumnArgs = {
  pantryIngredients: lemonGarlicChickenPantryWithOil,
  servings: 4,
  onServingsChange: fn(async () => true),
  tips,
  isTipsExpanded: true,
  onHowToPrepare: fn(),
} satisfies Partial<Story['args']>

/**
 * The ingredients section, whose box is the column's content width: the badge
 * row above it is as wide. The first `section` in the DOM; the steps follow.
 */
function contentColumn(canvasElement: HTMLElement): HTMLElement {
  const column = canvasElement.querySelector<HTMLElement>('section')
  if (!column) throw new Error('Ingredients column not found')
  return column
}

/** "Ingredients" and the pantry status: one line, inside the column. */
function assertHeaderUnbroken(heading: HTMLElement, status: HTMLElement): void {
  const column = heading.closest<HTMLElement>('section')!
  expectSingleLine(heading)
  expectSingleLine(status)
  expectWithinHorizontally(heading, column)
  expectWithinHorizontally(status, column)
}

/** The Serves badge's `::after` tap target, in px. */
function servesTarget(badge: HTMLElement): number {
  const after = getComputedStyle(badge, '::after')
  return badge.getBoundingClientRect().height - 2 * Number.parseFloat(after.top)
}

export const NarrowColumn: Story = {
  name: 'Narrow ingredients column',
  args: narrowColumnArgs,
  decorators: narrowColumnDecorator,
  parameters: {
    docs: {
      description: {
        story:
          'The ingredients column at its ~340px narrowest. The badge row holds Kid-friendly, the time and Serves, and opening the Serves field moves nothing (HON-1025). "Ingredients" and the status share one line, the status as plain text (HON-692, HON-1025).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { name: 'Ingredients' })
    const status = canvas.getByText(/to buy|all at home/)
    assertHeaderUnbroken(heading, status)
    await expect(status.getBoundingClientRect().top).toBeLessThan(
      heading.getBoundingClientRect().bottom,
    )

    // A phone-width column: the Serves badge is still a 44px+ target.
    const button = canvas.getByRole('button', { name: /serves 4/i })
    await expect(servesTarget(button)).toBeGreaterThanOrEqual(44)
    expectSingleLine(button)
    expectWithinHorizontally(button, contentColumn(canvasElement))

    const row = canvas.getByTestId('cook-view-badges')
    const before = badgeRowGeometry(row)
    await userEvent.click(button)
    await expect(canvas.getByLabelText('Number of servings')).toBeInTheDocument()
    await expect(badgeRowGeometry(row)).toEqual(before)
    await userEvent.keyboard('{Escape}')
  },
}

export const NarrowColumnEstonian: Story = {
  name: 'Narrow ingredients column (Estonian)',
  globals: { locale: 'et' },
  args: narrowColumnArgs,
  decorators: narrowColumnDecorator,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { name: 'Koostisosad' })
    assertHeaderUnbroken(heading, canvas.getByText(/vaja osta|kõik olemas/))
    const button = canvas.getByRole('button', { name: /4 portsjonit/ })
    expectSingleLine(button)
    expectWithinHorizontally(button, contentColumn(canvasElement))
  },
}

export const NarrowColumnCompleted: Story = {
  name: 'Narrow ingredients column (completed)',
  args: { ...narrowColumnArgs, status: 'completed', servings: 6 },
  decorators: narrowColumnDecorator,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { name: 'Ingredients' })
    expectSingleLine(heading)
    expectWithinHorizontally(heading, contentColumn(canvasElement))
    await expect(canvas.getByText('Serves 6')).toHaveAttribute('data-slot', 'badge')
    await expect(canvas.queryByRole('button', { name: /serves/i })).toBeNull()
  },
}

export const NarrowColumnCustomServingsEstonian: Story = {
  name: 'Narrow ingredients column (Estonian, custom servings)',
  globals: { locale: 'et' },
  args: { ...narrowColumnArgs, servings: 4, householdServings: 3 },
  decorators: narrowColumnDecorator,
  parameters: {
    docs: {
      description: {
        story:
          'The longest Serves badge: an overridden count adds the "(kohandatud)" suffix in the info tone. The badge stays whole on one line, and nothing overflows the column.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /4 portsjonit/ })
    await expect(button).toHaveTextContent(/^4 portsjonit\s*\(kohandatud\)$/)
    expectSingleLine(button)
    expectWithinHorizontally(button, contentColumn(canvasElement))
  },
}

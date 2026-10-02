import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  createMeal,
  lemonGarlicChickenComponentsFull,
  lemonGarlicChickenPantryWithOil,
} from '@/stories/fixtures'
import { expectSingleLine, expectWithinHorizontally } from '@/stories/layout-helpers'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
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
          'The cook view’s content (HON-932), outside its dialog. Below `lg` one scrolling column: hero, title, meta, note, ingredients, steps, nutrition last. From `lg` two columns that scroll on their own. `MealDetailModal` supplies the hero, title and note through slots.',
      },
    },
  },
  args: {
    meal: mealFixture,
    householdSize: 4,
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
          'The meta row: the time as the cards’ `surface` badge with a clock, at the cook view’s `lg` size, then the Kid-friendly badge (HON-951).',
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
    await expect(follows(time, kidFriendly)).toBe(true)
    // Both `lg`: the same height, on the same line.
    await expect(time.offsetHeight).toBe(kidFriendly.offsetHeight)
    await expect(time.offsetTop).toBe(kidFriendly.offsetTop)
  },
}

export const ZeroMinutes: Story = {
  name: 'No prep time',
  args: { meal: createMeal({ components: lemonGarlicChickenComponentsFull, timeMinutes: 0 }) },
  parameters: {
    docs: {
      description: {
        story:
          'A meal with no time, or 0 minutes, shows no time badge: only the Kid-friendly badge (HON-711, HON-951).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Kid-friendly')).toBeVisible()
    await expect(canvas.queryByText(/^\d+ min$/)).toBeNull()
    // No stray "0" where the badge would be (HON-711).
    const row = canvas.getByText('Kid-friendly').closest('[data-slot="badge"]')!.parentElement!
    await expect(row).toHaveTextContent(/^Kid-friendly$/)
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
          'The hero illustration (HON-737) is the first element, above the title and the description. `MealDetailModal` supplies it through the `image` slot.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const img = await within(canvasElement).findByRole('img', { name: 'Lemon garlic chicken' })
    // First child of the details, above the description.
    await expect(
      img.compareDocumentPosition(within(canvasElement).getByText(/crisp potatoes/i)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
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
          'Every household starts with salt, black pepper and water as staples (HON-769). A pantry holding only staples says nothing yet: the checkboxes stay, because they are how the user starts filling the pantry, but there is no badge and no row is marked missing (HON-824).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('checkbox')).toHaveLength(3)
    await expect(canvas.queryByText(/ingredients? to buy|have all ingredients/i)).toBeNull()
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
          'Ticking the first ingredient gives the pantry data, so the badge and the missing styling appear for the rest (HON-824).',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText(/ingredients? to buy/i)).toBeNull()

    await userEvent.click(canvas.getByRole('checkbox', { name: 'Mark Chicken thigh as available' }))

    await expect(args.onToggleAvailability).toHaveBeenCalledWith('chicken-thigh', true)
    await expect(await canvas.findByText('2 ingredients to buy')).toBeInTheDocument()
    await expect(missingRows(canvasElement).map((row) => row.textContent)).toEqual([
      expect.stringContaining('Potato'),
      expect.stringContaining('Lemon'),
    ])
  },
}

export const WithServingControl: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    servings: 4,
    onServingsChange: fn(async () => true),
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
          'A completed entry’s servings are what the pantry was charged for, so the API refuses to change them (HON-652). The count renders as static header text instead of the serving control.',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Ingredients (serves 6)')).toBeInTheDocument()
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
    const steps = canvas.getByTestId('cook-view-steps')
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
          'Loaded tips: the equipment as a "You’ll need" list under the ingredients, and the numbered steps, Watch out and Tip in the steps area, at the step size.',
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
    // The equipment sits with the ingredients, before the steps area.
    const equipment = canvas.getByRole('list', { name: "You'll need" })
    await expect(follows(equipment, steps)).toBe(true)
    await expect(steps).not.toContainElement(equipment)
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

/** The ingredients column: the section holding the header row. */
function ingredientsColumn(el: HTMLElement): HTMLElement {
  const column = el.closest<HTMLElement>('section')
  if (!column) throw new Error('Ingredients column not found')
  return column
}

function assertRowUnbroken(header: HTMLElement, badge: HTMLElement): void {
  const column = ingredientsColumn(header)
  expectSingleLine(header)
  expectSingleLine(badge)
  expectWithinHorizontally(header, column)
  expectWithinHorizontally(badge, column)
}

export const NarrowColumn: Story = {
  name: 'Narrow ingredients column',
  args: narrowColumnArgs,
  decorators: narrowColumnDecorator,
  parameters: {
    docs: {
      description: {
        story:
          'The ingredients column at its ~340px narrowest. "Ingredients" and the "Serves 4" control stay on one line with no brackets around the control (HON-763), in both the button and the editing state, and the availability badge moves to its own line rather than wrapping inside itself (HON-692).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const badge = canvas.getByText(/ingredients? to buy|have all ingredients/i)
    const button = canvas.getByRole('button', { name: /serves 4/i })
    const header = button.parentElement!
    await expect(within(header).getByText('Ingredients')).toBeInTheDocument()
    await expect(header).not.toHaveTextContent(/[()]/)
    assertRowUnbroken(header, badge)

    await userEvent.click(button)
    await expect(canvas.getByLabelText('Number of servings')).toBeInTheDocument()
    assertRowUnbroken(header, badge)
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
    const badge = canvas.getByText(/Vaja osta|olemas/)
    const header = canvas.getByRole('button', { name: /4 portsjonit/ }).parentElement!
    await expect(within(header).getByText('Koostisosad')).toBeInTheDocument()
    await expect(header).not.toHaveTextContent(/[()]/)
    assertRowUnbroken(header, badge)
  },
}

export const NarrowColumnCompleted: Story = {
  name: 'Narrow ingredients column (completed)',
  args: { ...narrowColumnArgs, status: 'completed', servings: 6 },
  decorators: narrowColumnDecorator,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const header = canvas.getByText('Ingredients (serves 6)')
    expectSingleLine(header)
    expectWithinHorizontally(header, ingredientsColumn(header))
  },
}

export const NarrowColumnCustomServingsEstonian: Story = {
  name: 'Narrow ingredients column (Estonian, custom servings)',
  globals: { locale: 'et' },
  args: { ...narrowColumnArgs, servings: 4, householdSize: 3 },
  decorators: narrowColumnDecorator,
  parameters: {
    docs: {
      description: {
        story:
          'The longest header: an overridden count adds the "(kohandatud)" suffix. When it cannot fit, the header breaks only between "Koostisosad" and the serving control — the control stays whole — and nothing overflows the column.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /4 portsjonit/ })
    const header = button.parentElement!
    const column = ingredientsColumn(header)
    await expect(within(header).getByText('Koostisosad')).toBeInTheDocument()
    await expect(button).toHaveTextContent(/^4 portsjonit\s*\(kohandatud\)$/)
    expectSingleLine(button)
    expectWithinHorizontally(header, column)
    expectWithinHorizontally(button, column)
  },
}

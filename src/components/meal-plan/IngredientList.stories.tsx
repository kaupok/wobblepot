import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { createMealComponent, lemonGarlicChickenComponentsFull } from '@/stories/fixtures'
import { expectSingleLine, expectWithinHorizontally } from '@/stories/layout-helpers'
import { IngredientList } from './IngredientList'
import type { PantryIngredient } from './types'

const vagueSalt = createMealComponent({
  ingredientId: 'salt',
  quantityPerServing: 1,
  isVague: true,
  originalPhrase: 'to taste',
})

// 350g/serving crosses 1000g total at 3+ servings, so the rice renders in kg
// with the locale's decimal separator (HON-950): en "1.4kg" at 4 servings,
// et "1,1kg" at 3.
const rice = createMealComponent({ ingredientId: 'short-grain-rice', quantityPerServing: 350 })

const componentsWithVagueSalt = [...lemonGarlicChickenComponentsFull, rice, vagueSalt]

const meta = {
  title: 'Meal plan/IngredientList',
  component: IngredientList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The cook view’s ingredients (HON-932): 18px rows at least 44px tall, the quantity first in a fixed-width column so the names line up, and the whole row the checkbox’s label, so a tap anywhere on it toggles the pantry.',
      },
    },
  },
  args: {
    components: componentsWithVagueSalt,
    servings: 4,
    householdServings: 4,
  },
  decorators: [
    (Story) => (
      <div className="max-w-md rounded-lg border p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IngredientList>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithPantryAvailability: Story = {
  args: {
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
      { ingredientId: 'olive-oil', isStaple: true },
      { ingredientId: 'salt', isStaple: true },
    ] satisfies PantryIngredient[],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The staples are ingredients the cook needs, so the line is in the
    // ingredient rows' colour, not muted (HON-1026). The size stays `text-sm`,
    // which is 16px in this scale (globals.css).
    const staples = canvas.getByText(/^Staples:/)
    await expect(getComputedStyle(staples).color).toBe(
      getComputedStyle(canvas.getByText('Chicken thigh')).color,
    )
    await expect(getComputedStyle(staples).fontSize).toBe('16px')
  },
}

export const WithCheckboxes: Story = {
  args: {
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
      { ingredientId: 'olive-oil', isStaple: true },
    ] satisfies PantryIngredient[],
    onToggleAvailability: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const rows = canvas.getAllByRole('listitem')
    for (const row of rows) {
      // A knuckle-sized target and the 18px row text (HON-932).
      await expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
      await expect(getComputedStyle(row.firstElementChild!).fontSize).toBe('18px')
    }
    // Quantity first: the names line up behind a fixed-width column.
    await expect(canvas.getByText('Potato').getBoundingClientRect().left).toBe(
      canvas.getByText('Lemon').getBoundingClientRect().left,
    )
    // The 24px checkbox.
    const checkbox = canvas.getByRole('checkbox', { name: /potato/i })
    await expect(checkbox.getBoundingClientRect().width).toBe(24)

    // A tap on the name, not the box, toggles it.
    await userEvent.click(canvas.getByText('Potato'))
    await expect(args.onToggleAvailability).toHaveBeenCalledWith('potato', true)
  },
}

export const WithAvailabilityStatus: Story = {
  args: {
    availability: {
      isReady: false,
      missingCount: 2,
      missingIngredients: ['Potato', 'Lemon'],
    },
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
    ] satisfies PantryIngredient[],
  },
  parameters: {
    docs: {
      description: {
        story:
          '"Ingredients 2 to buy": the pantry status as plain text after the heading, in the warning tone of the missing rows (HON-1025).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Ingredients' })).toBeInTheDocument()
    await expect(canvas.getByText('2 to buy')).toHaveClass('text-warning')
  },
}

export const AllAtHome: Story = {
  name: 'All at home',
  args: {
    availability: { isReady: true, missingCount: 0, missingIngredients: [] },
    pantryIngredients: componentsWithVagueSalt.map((c) => ({
      ingredientId: c.ingredientId,
      isStaple: false,
    })),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('all at home')).toHaveClass('text-success')
  },
}

export const NoPantryData: Story = {
  name: 'No pantry data',
  args: { availability: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { name: 'Ingredients' })
    // The heading alone: no status beside it.
    await expect(heading.parentElement!.children).toHaveLength(1)
  },
}

export const WithoutMissingStyle: Story = {
  args: {
    pantryIngredients: [
      { ingredientId: 'garlic', isStaple: true },
      { ingredientId: 'olive-oil', isStaple: true },
      { ingredientId: 'salt', isStaple: true },
    ] satisfies PantryIngredient[],
    onToggleAvailability: fn(),
    showMissingStyle: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'A pantry holding only staples says nothing yet (HON-824): `MealDetail` passes `showMissingStyle={false}`, so the checkboxes stay and no row is marked missing.',
      },
    },
  },
}

export const HideAvailability: Story = {
  args: {
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
    ] satisfies PantryIngredient[],
    hideAvailability: true,
  },
}

export const LargerServings: Story = {
  args: { servings: 8, householdServings: 4 },
}

/**
 * Estonian locale: piece quantities use a comma decimal separator and the
 * Estonian piece label. At 3 servings the lemon (0.5 per serving) renders as
 * "1,5 tk" — not "1.5 pc" — exercising the locale-aware `formatQuantity` path
 * (HON-546 item 1, HON-956). The rice (350g per
 * serving → 1050g) renders in kg with a comma: "1,1kg" (HON-950).
 */
export const EstonianLocale: Story = {
  name: 'Estonian (comma decimals)',
  globals: { locale: 'et' },
  args: { servings: 3, householdServings: 3 },
  // The salt's stored "to taste" renders through `enums.VaguePhrase` (HON-917).
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('maitse järgi')).toBeVisible()
    // The label hangs on a no-break space, which `getByText` folds into a space.
    const lemonQuantity = canvas.getByText('1,5 tk')
    await expect(lemonQuantity).toBeVisible()
    await expect(lemonQuantity.textContent).toBe('1,5\u00a0tk')
    await expect(canvas.getByText('1,1kg')).toBeVisible()
  },
}

const narrowArgs = {
  servings: 4,
  householdServings: 4,
  availability: { isReady: false, missingCount: 2, missingIngredients: ['Potato', 'Lemon'] },
} satisfies Partial<Story['args']>

// ~340px is the ingredients column at its narrowest: a 390px phone less the
// cook view's `px-5`, or its left 2/5 at 1024px less `px-6` (HON-932). The
// header used to fragment and squeeze the badge at this sort of width (HON-692);
// since HON-1025 it is the heading and a short text status.
const narrowDecorator: NonNullable<Story['decorators']> = [
  (Story) => (
    <div data-testid="narrow-column" className="w-85">
      <Story />
    </div>
  ),
]

async function assertHeaderUnbroken(
  canvasElement: HTMLElement,
  header: string,
  status: string,
): Promise<void> {
  const canvas = within(canvasElement)
  const column = canvas.getByTestId('narrow-column')
  const headerEl = canvas.getByRole('heading', { name: header })
  const statusEl = canvas.getByText(status)
  expectSingleLine(headerEl)
  expectSingleLine(statusEl)
  expectWithinHorizontally(headerEl, column)
  expectWithinHorizontally(statusEl, column)
  // One line: the status follows the heading on its baseline, as text, not a pill.
  await expect(statusEl.closest('[data-slot="badge"]')).toBeNull()
  await expect(statusEl.getBoundingClientRect().left).toBeGreaterThan(
    headerEl.getBoundingClientRect().right,
  )
  await expect(statusEl.getBoundingClientRect().top).toBeLessThan(
    headerEl.getBoundingClientRect().bottom,
  )
}

export const NarrowWithStatus: Story = {
  name: 'Narrow column with status',
  args: narrowArgs,
  decorators: narrowDecorator,
  parameters: {
    docs: {
      description: {
        story:
          'A ~340px column, the ingredients column at its narrowest in the cook view. "Ingredients" and the pantry status ("2 to buy", warning tone) share one line, the status as plain text on the heading\'s baseline (HON-1025).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await assertHeaderUnbroken(canvasElement, 'Ingredients', '2 to buy')
  },
}

export const NarrowWithStatusEstonian: Story = {
  name: 'Narrow column with status (Estonian)',
  globals: { locale: 'et' },
  args: narrowArgs,
  decorators: narrowDecorator,
  parameters: {
    docs: {
      description: {
        story: 'The narrow column in Estonian, whose heading and status run longer.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await assertHeaderUnbroken(canvasElement, 'Koostisosad', '2 vaja osta')
  },
}

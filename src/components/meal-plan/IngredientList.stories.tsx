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

// 350g/serving crosses 1000g total at 3+ servings, exercising the
// locale-aware grouping on the gram path (HON-556): en "1,400g", et "1400g"
// (CLDR Estonian only groups at 5+ digits).
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
    householdSize: 4,
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

export const WithAvailabilityBadge: Story = {
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
  args: { servings: 8, householdSize: 4 },
}

/**
 * Estonian locale: piece quantities use a comma decimal separator. At 3 servings
 * the lemon (0.5 per serving) renders as "1,5" — not "1.5" — exercising the
 * locale-aware `formatQuantity` path (HON-546 item 1). The rice (350g per
 * serving → 1050g) exercises the locale-aware gram path: `et` renders
 * "1050g" — no grouping below 5 digits per CLDR — where `en` would show
 * "1,050g" (HON-556).
 */
export const EstonianLocale: Story = {
  name: 'Estonian (comma decimals)',
  globals: { locale: 'et' },
  args: { servings: 3, householdSize: 3 },
  // The salt's stored "to taste" renders through `enums.VaguePhrase` (HON-917).
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('maitse järgi')).toBeVisible()
  },
}

const narrowArgs = {
  servings: 4,
  householdSize: 4,
  availability: { isReady: false, missingCount: 2, missingIngredients: ['Potato', 'Lemon'] },
} satisfies Partial<Story['args']>

// ~340px is the ingredients column at its narrowest: a 390px phone less the
// cook view's `px-5`, or its left 2/5 at 1024px less `px-6` (HON-932). The
// header used to fragment and squeeze the badge at this sort of width (HON-692).
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
  badge: string,
): Promise<void> {
  const canvas = within(canvasElement)
  const column = canvas.getByTestId('narrow-column')
  const headerEl = canvas.getByText(header)
  const badgeEl = canvas.getByText(badge)
  expectSingleLine(headerEl)
  expectSingleLine(badgeEl)
  expectWithinHorizontally(headerEl, column)
  expectWithinHorizontally(badgeEl, column)
}

export const NarrowWithBadge: Story = {
  name: 'Narrow column with badge',
  args: narrowArgs,
  decorators: narrowDecorator,
  parameters: {
    docs: {
      description: {
        story:
          'A ~340px column, the ingredients column at its narrowest in the cook view. The header stays on one line and the badge never wraps inside itself: when the row runs out of room the badge moves to its own line (HON-692).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await assertHeaderUnbroken(canvasElement, 'Ingredients (serves 4)', '2 ingredients to buy')
  },
}

export const NarrowWithBadgeEstonian: Story = {
  name: 'Narrow column with badge (Estonian)',
  globals: { locale: 'et' },
  args: narrowArgs,
  decorators: narrowDecorator,
  parameters: {
    docs: {
      description: {
        story: 'The narrow column in Estonian, whose header and badge strings run longer.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await assertHeaderUnbroken(
      canvasElement,
      'Koostisosad (4 portsjonit)',
      'Vaja osta 2 koostisosa',
    )
  },
}

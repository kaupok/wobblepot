import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn, within } from 'storybook/test'
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
  parameters: { layout: 'padded' },
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

export const Compact: Story = {
  args: { compact: true },
  parameters: {
    docs: {
      description: {
        story:
          'Compact tightens the gaps, not the type: the header, rows and staples line stay at the same size as the default list (HON-688).',
      },
    },
  },
}

export const CompactWithCheckboxes: Story = {
  args: {
    compact: true,
    pantryIngredients: [
      { ingredientId: 'chicken-thigh', isStaple: false },
      { ingredientId: 'garlic', isStaple: true },
      { ingredientId: 'olive-oil', isStaple: true },
    ] satisfies PantryIngredient[],
    onToggleAvailability: fn(),
  },
}

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
}

const narrowArgs = {
  servings: 4,
  householdSize: 4,
  availability: { isReady: false, missingCount: 2, missingIngredients: ['Potato', 'Lemon'] },
} satisfies Partial<Story['args']>

// ~300px is the ingredients column in the desktop meal detail modal, where the
// header used to fragment and squeeze the badge (HON-692).
const narrowDecorator: NonNullable<Story['decorators']> = [
  (Story) => (
    <div data-testid="narrow-column" className="w-75">
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
          'A ~300px column, the width of the ingredients column in the desktop meal detail modal. The header stays on one line and the badge never wraps inside itself: when the row runs out of room the badge moves to its own line (HON-692).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await assertHeaderUnbroken(canvasElement, 'Ingredients (serves 4)', '2 ingredients missing')
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
    await assertHeaderUnbroken(canvasElement, 'Koostisosad (4 portsjonit)', '2 koostisosa puudu')
  },
}

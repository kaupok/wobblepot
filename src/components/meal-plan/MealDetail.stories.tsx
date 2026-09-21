import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  createMeal,
  lemonGarlicChickenComponentsFull,
  lemonGarlicChickenPantryWithOil,
} from '@/stories/fixtures'
import { expectSingleLine, expectWithinHorizontally } from '@/stories/layout-helpers'
import mealIllustration from '@/stories/assets/meal-illustration.jpg'
import { MealDetail } from './MealDetail'
import { MealImage } from './MealImage'
import type { StructuredTips } from './types'

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
  parameters: { layout: 'padded' },
  args: {
    meal: mealFixture,
    householdSize: 4,
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl rounded-lg border p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MealDetail>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

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
          'Seeded meals carry a description (a localized `MealTranslation` field). It renders as muted body text above the nutrition summary.',
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
      <MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={mealIllustration.src} />
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          'The hero illustration (HON-737) is the first element, above the description. `MealDetailModal` supplies it through the `image` slot.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const img = await within(canvasElement).findByRole('img', { name: 'Lemon garlic chicken' })
    // First child of the details, above the description.
    await expect(
      img.compareDocumentPosition(within(canvasElement).getByText(/lemon-garlic roast chicken/i)) &
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

export const TipsCollapsed: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    onHowToPrepare: fn(),
  },
}

export const TipsExpanded: Story = {
  args: {
    pantryIngredients: lemonGarlicChickenPantryWithOil,
    tips,
    isTipsExpanded: true,
    onHowToPrepare: fn(),
    onHideTips: fn(),
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
    onHideTips: fn(),
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

// The ingredients column at ~300px, the width it gets in the desktop meal detail
// modal (HON-692): below md the grid is one 300px column; at md+ a 640px
// container splits into two ~300px columns beside the preparation panel. The
// Vitest browser viewport sits below md, so CI exercises the first case.
const narrowColumnDecorator: NonNullable<Story['decorators']> = [
  (Story) => (
    <div className="w-75 md:w-160">
      <Story />
    </div>
  ),
]

const narrowColumnArgs = {
  pantryIngredients: lemonGarlicChickenPantryWithOil,
  servings: 4,
  onServingsChange: fn(async () => true),
  onHowToPrepare: fn(),
} satisfies Partial<Story['args']>

/** The ingredients column: the grid cell holding the header row. */
function ingredientsColumn(el: HTMLElement): HTMLElement {
  const column = el.closest<HTMLElement>('.grid > *')
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
          'The ingredients column at the ~300px width of the desktop modal. "Ingredients (Serves 4)" stays on one line with its parentheses joined, in both the button and the editing state, and the availability badge moves to its own line rather than wrapping inside itself (HON-692).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const badge = canvas.getByText(/ingredients? missing|have all ingredients/i)
    const button = canvas.getByRole('button', { name: /serves 4/i })
    const header = button.parentElement!
    await expect(header).toHaveTextContent('Ingredients (Serves 4)')
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
    const badge = canvas.getByText(/puudu|olemas/)
    const header = canvas.getByRole('button', { name: /4 portsjonit/ }).parentElement!
    await expect(header).toHaveTextContent('Koostisosad (4 portsjonit)')
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
          'The longest header: an overridden count adds the "(kohandatud)" suffix. When it cannot fit, the header breaks only at the space after "Koostisosad" — the serving control stays whole with its parentheses attached — and nothing overflows the column.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /4 portsjonit/ })
    const header = button.parentElement!
    const column = ingredientsColumn(header)
    await expect(header).toHaveTextContent(/^Koostisosad \(4 portsjonit\s*\(kohandatud\)\)$/)
    expectSingleLine(button)
    expectWithinHorizontally(header, column)
    expectWithinHorizontally(button, column)
  },
}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import { TimelineDayCard } from '@/components/timeline/TimelineDayCard'
import {
  createMeal,
  createMealComponent,
  createPlanEntry,
  createTimelineDay,
  lemonGarlicChickenComponentsFull,
  lemonGarlicChickenPantry,
  lemonGarlicChickenPantryItems,
} from '@/stories/fixtures'
import { assertDesignRules, SCENARIO_RULES } from '@/stories/design-rules'

/**
 * Everything this meal needs is in {@link lemonGarlicChickenPantry} — chicken
 * (800g on hand, 600g needed at four servings) and garlic as a staple. Gives
 * the fully-available end of the availability scale.
 */
const stockedLunch = createPlanEntry({
  id: 'entry-scenario-lunch',
  mealType: MealType.lunch,
  meal: createMeal({
    id: 'meal-scenario-lunch',
    name: 'Garlic chicken rice bowl',
    timeMinutes: 25,
    components: [
      createMealComponent({ ingredientId: 'chicken-thigh', quantityPerServing: 150 }),
      createMealComponent({ ingredientId: 'garlic', quantityPerServing: 2 }),
    ],
  }),
})

/**
 * Five components against the same two-ingredient pantry — potato, lemon and
 * olive oil are all missing, so the card renders the shopping-needed end of
 * the scale next to the stocked one.
 */
const understockedDinner = createPlanEntry({
  id: 'entry-scenario-dinner',
  mealType: MealType.dinner,
  meal: createMeal({ components: lemonGarlicChickenComponentsFull }),
})

const meta = {
  title: 'Scenarios/Timeline day',
  component: TimelineDayCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One day of the `/meal-plan` timeline with two meals on it. Makes visible: the meal-type caption sitting above each card rather than inside it, the day name at the Section level, the availability status colours on their semantic tokens, and the card actions consolidated into one row on the title line. Props are fixed — see `.storybook/README.md` → "Scenario stories".',
      },
    },
  },
  args: {
    planId: 'plan-1',
    householdSize: 4,
    pantryIngredients: lemonGarlicChickenPantry,
    pantryItems: lemonGarlicChickenPantryItems,
    onEntryUpdated: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TimelineDayCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    day: createTimelineDay({ entries: [stockedLunch, understockedDinner] }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Today, with a lunch whose ingredients are all in the pantry and a dinner missing three of five. The two cards sit side by side in the same column, so a status colour that stopped meaning anything would be visible immediately.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await assertDesignRules(canvasElement, SCENARIO_RULES)
  },
}

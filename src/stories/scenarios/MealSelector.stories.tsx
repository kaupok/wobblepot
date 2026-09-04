import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import { MealSelectorModal } from '@/components/meal-plan/MealSelectorModal'
import { assertDesignRules, SCENARIO_RULES } from '@/stories/design-rules'

const meta = {
  title: 'Scenarios/Meal selector',
  component: MealSelectorModal,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The meal-swap dialog as the user meets it: title row, search, filter, and a grid of alternatives. The one scenario that keeps MSW — `MealSelectorModal` owns its queries, and the default handlers in `src/stories/msw-handlers.ts` are fixed fixtures that already run in CI. Per-story handler overrides (loading, empty, error) belong in `Meal plan/MealSelectorModal`, not here.',
      },
    },
  },
  args: {
    open: true,
    mode: 'swap',
    currentMealName: 'Lemon-garlic roast chicken',
    onOpenChange: fn(),
    planId: 'plan-1',
    entryId: 'entry-1',
    householdSize: 4,
    mealType: MealType.dinner,
    onSwapComplete: fn(),
  },
} satisfies Meta<typeof MealSelectorModal>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Swap mode with the default suggestions loaded. Makes visible: the alternative cards grouped inside the dialog without a second card wrapping them, heading order under the dialog title (`h2` title → `h3` meal names), and one primary action per card rather than three buttons of equal weight. It also shows where the code and the guide disagree — `AlternativeCard` puts its Select button in a `CardFooter`, which "Actions sit on the title row" rules out. Surfacing that is the point of a scenario; changing it is not this story\'s call.',
      },
    },
  },
  // Interaction a11y (focus trap, tab containment, Escape, close sequence) is
  // asserted in `Meal plan/MealSelectorModal` → `A11yInteractionPatterns`, per
  // CLAUDE.md. This scenario owns the composition rules only, and asserts them
  // against the portal root — Radix renders dialog content outside
  // `canvasElement`, and `DialogContent` is `position: fixed` by design, which
  // is why the helper checks the subtree under the root rather than the root.
  play: async () => {
    const body = within(document.body)
    const dialog = await body.findByRole('dialog')
    // Wait for the alternatives to replace `AlternativeSkeleton`; asserting
    // against the skeleton grid would pass without checking the real layout.
    await body.findAllByRole('button', { name: /^select$/i }, { timeout: 5000 })
    await assertDesignRules(dialog, SCENARIO_RULES)
  },
}

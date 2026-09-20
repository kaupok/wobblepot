import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import {
  createMeal,
  lemonGarlicChickenPantry,
  lemonGarlicChickenPantryItems,
} from '@/stories/fixtures'
import { MealCard } from './MealCard'

const mealFixture = createMeal()

const meta = {
  title: 'Meal plan/MealCard',
  component: MealCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    entryId: 'entry-1',
    planId: 'plan-1',
    mealType: MealType.dinner,
    householdSize: 4,
    pantryIngredients: lemonGarlicChickenPantry,
    pantryItems: lemonGarlicChickenPantryItems,
  },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MealCard>

export default meta
type Story = StoryObj<typeof meta>

/** Swap and Clear live behind the card's "More actions" menu (HON-688). */
async function openMoreActions(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /more actions/i }))
}

export const Planned: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // Every control on the card clears the 32px `sm` floor (HON-688) — the
    // meal name included, which is a wrapping text button rather than a
    // `Button` and so takes its height from `min-h-8`, not a size variant.
    for (const button of canvas.getAllByRole('button')) {
      await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(32)
    }

    // The counterpart to `CompletedThumbsUp` below: Swap is offered here, so
    // its absence there cannot pass on a card that failed to render at all.
    await openMoreActions(canvasElement)
    await expect(
      await within(document.body).findByRole('menuitem', { name: /^swap$/i }),
    ).toBeInTheDocument()
  },
}

export const PlannedAlreadyCharged: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    pantryDeducted: true,
    // The status control only renders on past days.
    isPast: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Completed once, then reverted to planned. The pantry was already charged and the server never charges an entry twice (HON-651), so completing again skips the deduction preview.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.click(canvas.getByRole('combobox', { name: /meal status/i }))
    await userEvent.click(await body.findByRole('option', { name: /completed/i }))

    // The status did change — so the missing dialog below is not a click that
    // never landed.
    await waitFor(() =>
      expect(canvas.getByRole('combobox', { name: /meal status/i })).toHaveTextContent(
        /completed/i,
      ),
    )
    await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
  },
}

// Counts the tips POSTs the story's handler serves, so the second click can be
// proven to be a real re-fetch rather than a replay of the hook's cached state.
let swapTipsRequests = 0

/**
 * A swap repoints the entry server-side, and the same PATCH nulls the entry's
 * cached `preparationTips` and resets its `servingOverride`. Neither reset
 * reaches the client on its own. The detail modal is rendered unconditionally
 * by this card
 * — `open` is a prop, not a mount guard — so its `useMealTips` instance never
 * unmounts, and `entryId` does not change on a swap either; the serving count
 * is this card's own `useState`. Without the reset in `onSwapComplete`,
 * reopening the modal replays the previous meal's tips under the new meal's
 * name and never re-POSTs, and the card keeps the old override (HON-682).
 *
 * The card still shows the old meal name after the swap here: the real reset
 * comes from `router.refresh()`, which is a no-op under the Storybook app-router
 * mock. That is fine — what this story pins is the client state the refresh
 * cannot reach.
 */
export const SwapDropsCachedTips: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    // The swap resets this to null server-side, so the badge must go with it.
    servingOverride: 6,
  },
  parameters: {
    // Keyed rather than an array, so `defaultHandlers` — which already serve
    // the swap suggestions and the entry PATCH — are extended, not replaced.
    msw: {
      handlers: {
        tips: [
          // Varies per call, so the second click can be told apart from a
          // replay of the first one's object.
          http.post('/api/meal-plans/:planId/entries/:entryId/preparation-tips', () => {
            swapTipsRequests += 1
            return HttpResponse.json({
              tips: {
                equipment: [
                  swapTipsRequests === 1
                    ? 'A roasting tin for the chicken'
                    : 'A wok for the stir-fry',
                ],
                steps: ['Preheat while you prep'],
                pitfalls: ['Crowding the pan steams instead of browning'],
              },
            })
          }),
        ],
      },
    },
  },
  play: async ({ canvasElement }) => {
    swapTipsRequests = 0
    const canvas = within(canvasElement)
    const body = within(document.body)

    // Generate tips for the meal currently on the entry.
    await expect(canvas.getByText('6 servings')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: /lemon-garlic roast chicken/i }))
    await userEvent.click(await body.findByRole('button', { name: /how to prepare/i }))
    await body.findByText(/roasting tin/i)

    // Close the detail modal — the Swap control lives on the card behind it.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())

    // Swap the entry to a different meal.
    await openMoreActions(canvasElement)
    await userEvent.click(await body.findByRole('menuitem', { name: /^swap$/i }))
    const selector = await body.findByRole('dialog')
    const [firstSelect] = await within(selector).findAllByRole('button', { name: /^select$/i })
    if (!firstSelect) throw new Error('The swap selector rendered no alternatives to pick')
    await userEvent.click(firstSelect)
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())

    // The card is back to the household's own size, matching the
    // `servingOverride: null` the server wrote.
    await waitFor(() => expect(canvas.queryByText('6 servings')).not.toBeInTheDocument())

    // Reopen the modal. The panel offers the prompt again rather than the
    // previous meal's expanded tips, and the serving control agrees with the
    // card...
    await userEvent.click(canvas.getByRole('button', { name: /lemon-garlic roast chicken/i }))
    const reopened = await body.findByRole('dialog')
    await expect(within(reopened).getByRole('button', { name: /serves 4/i })).toBeInTheDocument()
    const prompt = await body.findByRole('button', { name: /how to prepare/i })
    await expect(body.queryByText(/roasting tin/i)).not.toBeInTheDocument()

    // ...and asking again issues a real second POST. This is the assertion
    // that pins `cancelTips()`: collapsing the panel alone would satisfy
    // everything above, because `MealDetail` renders the prompt off
    // `isTipsExpanded` and never reads `tips` — but with the stale object
    // still in the hook, `handleHowToPrepare` just re-expands it.
    await userEvent.click(prompt)
    await body.findByText(/wok for the stir-fry/i)
    await expect(swapTipsRequests).toBe(2)
  },
}

export const PlannedWithNote: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    note: 'Double the garlic — kids approved.',
  },
}

export const WithServingOverride: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    servingOverride: 6,
  },
}

export const LowAvailability: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    pantryIngredients: [{ ingredientId: 'garlic', isStaple: true }],
  },
  parameters: {
    docs: {
      description: {
        story: 'Most ingredients missing from pantry — shows amber availability indicator.',
      },
    },
  },
}

export const CompletedThumbsUp: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: 'up',
  },
  parameters: {
    docs: {
      description: {
        story:
          'No Swap control: a completed entry records what was cooked and what the pantry was charged for, and the API refuses to repoint it (409, HON-633). Note and Clear stay available.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)
    await openMoreActions(canvasElement)
    // Clear is in the same menu, so the missing Swap is not a menu that never
    // opened. Note sits outside it and is unaffected.
    await expect(await body.findByRole('menuitem', { name: /^clear$/i })).toBeInTheDocument()
    await expect(body.queryByRole('menuitem', { name: /^swap$/i })).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /^note$/i })).toBeInTheDocument()
  },
}

export const CompletedThumbsDown: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: 'down',
  },
}

export const CompletedUnrated: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: null,
  },
}

export const Skipped: Story = {
  args: {
    meal: mealFixture,
    status: 'skipped',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Swap is still offered: nothing was deducted for a skipped meal, so “actually, let’s cook something” stays a legitimate path (HON-633).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await openMoreActions(canvasElement)
    await expect(
      await within(document.body).findByRole('menuitem', { name: /^swap$/i }),
    ).toBeInTheDocument()
  },
}

export const PastCompleted: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: 'up',
    isPast: true,
  },
}

export const PastReadonly: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: 'up',
    isPast: true,
    isReadOnly: true,
  },
}

export const EmptyPlanned: Story = {
  args: {
    meal: null,
    status: 'planned',
  },
}

export const EmptyWithNote: Story = {
  args: {
    meal: null,
    status: 'planned',
    note: 'Maybe leftovers tonight.',
  },
}

export const EmptyReadonly: Story = {
  args: {
    meal: null,
    status: 'planned',
    isReadOnly: true,
  },
}

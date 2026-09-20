import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import {
  createMeal,
  lemonGarlicChickenComponents,
  lemonGarlicChickenPantry,
  lemonGarlicChickenPantryItems,
} from '@/stories/fixtures'
import type { AlternativeMeal } from './types'
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

// Counts the POSTs the story's handlers serve, so a second one can be proven to
// be a real re-fetch rather than a replay of cached state.
let swapTipsRequests = 0
let swapSuggestionRequests = 0

/**
 * Stands in for `regenerate/route.ts`, which excludes whichever meal the entry
 * holds when the list is built. Call 1 runs against the chicken and offers the
 * stir-fry; call 2 runs against the stir-fry just picked and offers the risotto
 * instead — so a replayed call-1 list is visible as the stir-fry being proposed
 * as an alternative to itself.
 */
function swapAlternatives(call: number): AlternativeMeal[] {
  const meal = (id: string, name: string): AlternativeMeal => ({
    id,
    name,
    description: `${name} — a weeknight alternative.`,
    timeMinutes: 30,
    kidFriendly: true,
    primaryProteinType: 'none',
    suitableFor: [MealType.dinner],
    components: lemonGarlicChickenComponents,
    nutrition: { calories: 480, protein: 30, carbs: 40, fat: 18 },
  })
  return call === 1
    ? [meal('meal-stir-fry', 'Beef stir-fry')]
    : [meal('meal-risotto', 'Mushroom risotto')]
}

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
    // An array replaces `defaultHandlers` wholesale, which is what this story
    // needs: it has to count the suggestions POST, and a keyed override would
    // merely be appended after the default handler that already matches it.
    // So the entry PATCH has to be re-declared alongside — without it the swap
    // fails and nothing downstream is asserted.
    msw: {
      handlers: [
        http.patch('/api/meal-plans/:planId/entries/:entryId', () =>
          HttpResponse.json({ ok: true }),
        ),
        // The real route filters out whichever meal the entry currently holds,
        // so the list is only correct for the meal it was built against.
        http.post('/api/meal-plans/:planId/entries/:entryId/regenerate', () => {
          swapSuggestionRequests += 1
          return HttpResponse.json({ alternatives: swapAlternatives(swapSuggestionRequests) })
        }),
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
  play: async ({ canvasElement }) => {
    swapTipsRequests = 0
    swapSuggestionRequests = 0
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
    await within(selector).findByText('Beef stir-fry')
    await userEvent.click(within(selector).getByRole('button', { name: /^select$/i }))
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

    // The suggestions list is stale for the same reason and at the same
    // callsite: its query key carries no meal id, it is held at
    // `staleTime: Infinity`, and the selector never unmounts either. Replayed,
    // it would offer the meal just picked as an alternative to itself, and
    // picking it would re-PATCH the entry to the meal it already holds.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())
    await openMoreActions(canvasElement)
    await userEvent.click(await body.findByRole('menuitem', { name: /^swap$/i }))
    const reopenedSelector = await body.findByRole('dialog')
    await within(reopenedSelector).findByText('Mushroom risotto')
    await expect(within(reopenedSelector).queryByText('Beef stir-fry')).not.toBeInTheDocument()
    await expect(swapSuggestionRequests).toBe(2)
  },
}

// Per-entry suggestion POST counts, so the second card's list can be shown to
// refetch after the first card swaps.
const planSuggestionRequests: Record<string, number> = {}

// POSTs served while re-selecting the meal already on the entry.
let reselectTipsRequests = 0

/**
 * Selecting a meal is not necessarily a *swap*. `/regenerate` filters the
 * planned meal out of its suggestions, but search and "my recipes" browse go
 * to `/api/meals` unfiltered (`meal-selector/use-meal-alternatives.ts`), so the
 * dish already on the entry is listed there and can be clicked —
 * `MealSelectorModal.handleSelect` PATCHes whatever row was selected.
 *
 * That write changes nothing, and the server treats it as nothing: the three
 * resets in the swap branch are gated on `parsed.data.mealId !== entry.mealId`,
 * so `servingOverride`, `preparationTips` and `rating` all survive (HON-703).
 * The card has to draw the same line — it resets its own copies in
 * `onSwapComplete`, and `router.refresh()` cannot reseed a `useState`, so an
 * unconditional reset would leave the card showing 4 servings against a row
 * that says 6 for the rest of the session.
 *
 * The counterpart to `SwapDropsCachedTips` above: same controls, same
 * assertions, opposite expectations — which is what makes either story
 * meaningful.
 */
export const ReselectingThePlannedMealResetsNothing: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    // Household is 4, so this renders a "6 servings" badge — and the badge is
    // the assertion, since a reset would drop it back to the household size.
    servingOverride: 6,
  },
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/meal-plans/:planId/entries/:entryId', () =>
          HttpResponse.json({ ok: true }),
        ),
        // Search does not exclude the planned meal, so it comes back with the
        // very id the entry already holds — the whole point of the story.
        http.get('/api/meals', () =>
          HttpResponse.json({
            meals: [
              {
                id: mealFixture.id,
                name: mealFixture.name,
                description: 'The dish already on this entry.',
                timeMinutes: 45,
                kidFriendly: true,
                primaryProteinType: 'poultry',
                suitableFor: [MealType.dinner],
                components: lemonGarlicChickenComponents,
                nutrition: { calories: 520, protein: 42, carbs: 30, fat: 28 },
              },
            ],
            hasMore: false,
            total: 1,
          }),
        ),
        http.post('/api/meal-plans/:planId/entries/:entryId/regenerate', () =>
          HttpResponse.json({ alternatives: swapAlternatives(1) }),
        ),
        http.post('/api/meal-plans/:planId/entries/:entryId/preparation-tips', () => {
          reselectTipsRequests += 1
          return HttpResponse.json({
            tips: {
              equipment: ['A roasting tin for the chicken'],
              steps: ['Preheat while you prep'],
              pitfalls: ['Crowding the pan steams instead of browning'],
            },
          })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    reselectTipsRequests = 0
    const canvas = within(canvasElement)
    const body = within(document.body)

    // Generate tips for the planned meal, so there is something to lose.
    await expect(canvas.getByText('6 servings')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: /lemon-garlic roast chicken/i }))
    await userEvent.click(await body.findByRole('button', { name: /how to prepare/i }))
    await body.findByText(/roasting tin/i)
    await expect(reselectTipsRequests).toBe(1)

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())

    // Search for the meal already planned and select it again.
    await openMoreActions(canvasElement)
    await userEvent.click(await body.findByRole('menuitem', { name: /^swap$/i }))
    const selector = await body.findByRole('dialog')
    await userEvent.type(within(selector).getByRole('searchbox'), 'lemon')
    // The search list offers the planned dish back — `/regenerate` would not.
    const result = await within(selector).findByText(mealFixture.name)
    await expect(result).toBeInTheDocument()
    await userEvent.click(within(selector).getByRole('button', { name: /^select$/i }))
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())

    // The override the household set is still on the card, matching the row
    // the server did not touch.
    await expect(canvas.getByText('6 servings')).toBeInTheDocument()

    // And the tips were not discarded: reopening shows them still expanded,
    // and no second POST was issued. `SwapDropsCachedTips` asserts the exact
    // opposite pair for a real swap.
    await userEvent.click(canvas.getByRole('button', { name: /lemon-garlic roast chicken/i }))
    const reopened = await body.findByRole('dialog')
    await expect(within(reopened).getByText(/roasting tin/i)).toBeInTheDocument()
    await expect(reselectTipsRequests).toBe(1)
  },
}

/**
 * The suggestions cache has to be dropped for the whole plan, not just the
 * entry that was swapped. Both suggestion routes filter candidates through
 * `recentMealIds` — every meal the household planned within `NO_REPEAT_DAYS`,
 * excluded by `candidates.ts:128` — so planning a meal on Monday removes it
 * from Tuesday's candidate set too. Every card shares one `QueryClient` and the
 * key is held at `staleTime: Infinity`, so a per-entry removal would leave
 * Tuesday still offering the meal just planned for Monday, and picking it would
 * plan the same dinner twice in one week (review round 2 on PR #785).
 */
export const SwapDropsSuggestionsForSiblingEntries: Story = {
  args: { meal: mealFixture, status: 'planned' },
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/meal-plans/:planId/entries/:entryId', () =>
          HttpResponse.json({ ok: true }),
        ),
        http.post('/api/meal-plans/:planId/entries/:entryId/regenerate', ({ params }) => {
          const entryId = String(params.entryId)
          const call = (planSuggestionRequests[entryId] ?? 0) + 1
          planSuggestionRequests[entryId] = call
          return HttpResponse.json({ alternatives: swapAlternatives(call) })
        }),
      ],
    },
  },
  // Two cards on one plan, sharing the page's QueryClient exactly as the
  // timeline renders them.
  render: (args) => (
    <div className="flex flex-col gap-4">
      <div data-testid="monday">
        <MealCard {...args} entryId="entry-monday" />
      </div>
      <div data-testid="tuesday">
        <MealCard {...args} entryId="entry-tuesday" />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    planSuggestionRequests['entry-monday'] = 0
    planSuggestionRequests['entry-tuesday'] = 0
    const canvas = within(canvasElement)
    const body = within(document.body)

    const monday = within(canvas.getByTestId('monday'))
    const tuesday = within(canvas.getByTestId('tuesday'))

    const openSwap = async (card: ReturnType<typeof within>) => {
      await userEvent.click(card.getByRole('button', { name: /more actions/i }))
      await userEvent.click(await body.findByRole('menuitem', { name: /^swap$/i }))
      return body.findByRole('dialog')
    }
    const closeSwap = async () => {
      await userEvent.keyboard('{Escape}')
      await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())
    }

    // Tuesday caches a list that still offers the stir-fry.
    const tuesdayFirst = await openSwap(tuesday)
    await within(tuesdayFirst).findByText('Beef stir-fry')
    await closeSwap()

    // Monday takes the stir-fry.
    const mondaySwap = await openSwap(monday)
    await within(mondaySwap).findByText('Beef stir-fry')
    await userEvent.click(within(mondaySwap).getByRole('button', { name: /^select$/i }))
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())

    // Tuesday must refetch rather than replay — the stir-fry is Monday's
    // dinner now, and offering it here would plan it twice in one week.
    const tuesdaySecond = await openSwap(tuesday)
    await within(tuesdaySecond).findByText('Mushroom risotto')
    await expect(within(tuesdaySecond).queryByText('Beef stir-fry')).not.toBeInTheDocument()
    await expect(planSuggestionRequests['entry-tuesday']).toBe(2)
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

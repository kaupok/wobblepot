import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MealType } from '@/generated/prisma/enums'
import {
  createMeal,
  lemonGarlicChickenPantry,
  lemonGarlicChickenPantryItems,
} from '@/stories/fixtures'
import { defaultHandlers } from '@/stories/msw-handlers'

import { MealCard } from './MealCard'

/**
 * A cooked planner card's rating, inside the Cooked badge (HON-1589):
 * `[Cooked | 👍 👎]`, with no "How was it?" strip and no "Rate" row below
 * the card. `MealCard.stories.tsx` is at its file-size cap, so the rating
 * states live here; `CompletedThumbsUp` and the photo-and-note geometry
 * (`Completed with image, note and rating`) stay there.
 */
const meta = {
  title: 'Meal plan/MealCard/Rating',
  component: MealCard,
  parameters: { layout: 'padded' },
  args: {
    entryId: 'entry-1',
    planId: 'plan-1',
    date: '2026-10-10',
    mealType: MealType.dinner,
    householdServings: 4,
    pantryIngredients: lemonGarlicChickenPantry,
    pantryItems: lemonGarlicChickenPantryItems,
    meal: createMeal(),
    status: 'completed',
  },
  decorators: [
    // `phone` is a 390px screen less the page's `px-4`, as in `MealCard.stories.tsx`.
    (Story, { parameters }) => (
      <div className={parameters.cardWidth === 'phone' ? 'w-[358px]' : 'max-w-xs'}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MealCard>

export default meta
type Story = StoryObj<typeof meta>

const ROUND_TRIP = { timeout: 3000 }

/** The rating PATCH bodies the entry handler received. */
let ratingPatches: Record<string, unknown>[] = []

const ratingPatchHandlers = {
  default: [
    http.patch('/api/meal-plans/:planId/entries/:entryId', async ({ request }) => {
      ratingPatches.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json({ ok: true })
    }),
    ...defaultHandlers,
  ],
}

/** Expects `rating` pressed and the other thumb not, both inside the Cooked badge. */
async function expectThumbsPressed(canvasElement: HTMLElement, rating: 'up' | 'down' | null) {
  const canvas = within(canvasElement)
  const up = canvas.getByRole('button', { name: 'Thumbs up' })
  const down = canvas.getByRole('button', { name: 'Thumbs down' })
  await expect(up.closest('[data-slot="badge"]')).toHaveTextContent(/^cooked$/i)
  await expect(down.closest('[data-slot="badge"]')).toBe(up.closest('[data-slot="badge"]'))
  await waitFor(() => expect(up).toHaveAttribute('aria-pressed', String(rating === 'up')))
  await expect(down).toHaveAttribute('aria-pressed', String(rating === 'down'))
}

/**
 * Cooked and unrated: one pill, "Cooked" and two outlined thumbs, with no row
 * below the card. A click on a thumb rates, a click on the other switches it,
 * and a click on the chosen thumb clears it.
 */
export const CompletedUnrated: Story = {
  args: { rating: null },
  parameters: { msw: { handlers: ratingPatchHandlers } },
  play: async ({ canvasElement }) => {
    ratingPatches = []
    const canvas = within(canvasElement)
    await expectThumbsPressed(canvasElement, null)
    await expect(canvas.queryByText('How was it?')).not.toBeInTheDocument()
    await expect(canvas.queryByText('Rate')).not.toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: 'Thumbs up' }))
    await expectThumbsPressed(canvasElement, 'up')
    await waitFor(() => expect(ratingPatches).toEqual([{ rating: 'up' }]), ROUND_TRIP)

    await userEvent.click(canvas.getByRole('button', { name: 'Thumbs down' }))
    await expectThumbsPressed(canvasElement, 'down')
    await waitFor(() => expect(ratingPatches).toHaveLength(2), ROUND_TRIP)

    await userEvent.click(canvas.getByRole('button', { name: 'Thumbs down' }))
    await expectThumbsPressed(canvasElement, null)
    await waitFor(
      () => expect(ratingPatches).toEqual([{ rating: 'up' }, { rating: 'down' }, { rating: null }]),
      ROUND_TRIP,
    )
  },
}

export const CompletedThumbsDown: Story = {
  args: { rating: 'down' },
  play: async ({ canvasElement }) => expectThumbsPressed(canvasElement, 'down'),
}

/** Read-only: "Cooked" and the chosen thumb, with no buttons. */
export const CompletedReadonly: Story = {
  args: { rating: 'up', isReadOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const badge = canvas.getByText('Thumbs up').closest('[data-slot="badge"]')!
    await expect(badge).toHaveTextContent('CookedThumbs up')
    await expect(canvas.queryByRole('button', { name: /^thumbs/i })).not.toBeInTheDocument()
    await expect(canvas.queryByText('Thumbs down')).not.toBeInTheDocument()
  },
}

/** Read-only and unrated: the plain Cooked badge. */
export const CompletedReadonlyUnrated: Story = {
  args: { rating: null, isReadOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Cooked')).toHaveAttribute('data-variant', 'surface')
    await expect(canvas.queryByText(/^thumbs/i)).not.toBeInTheDocument()
  },
}

/** Estonian on a phone, with a servings badge beside the pill: it wraps whole. */
export const CompletedWithServingsPhoneEstonian: Story = {
  args: { rating: 'up', servingOverride: 2 },
  globals: { locale: 'et' },
  parameters: { cardWidth: 'phone' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const up = canvas.getByRole('button', { name: 'Pöial üles' })
    const pill = up.closest<HTMLElement>('[data-slot="badge"]')!
    await expect(pill).toHaveTextContent('Tehtud')
    const pillBox = pill.getBoundingClientRect()
    for (const thumb of [up, canvas.getByRole('button', { name: 'Pöial alla' })]) {
      const box = thumb.getBoundingClientRect()
      await expect(box.top).toBeGreaterThanOrEqual(pillBox.top)
      await expect(box.bottom).toBeLessThanOrEqual(pillBox.bottom)
    }
    await expect(pillBox.height).toBeLessThanOrEqual(26)
  },
}

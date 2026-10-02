import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { createMeal } from '@/stories/fixtures'
import { track } from '@/lib/analytics'
import { MealCard } from './MealCard'
import type { PantryIngredient, StructuredTips } from './types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

// The list is not under test here; a stub keeps the selector free of
// suggestion fixtures.
vi.mock('@/components/meal-plan/meal-selector/AlternativesList', () => ({
  AlternativesList: () => <div>alternatives</div>,
}))

const meal = createMeal()

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ suggestions: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderCard(props: {
  meal: typeof meal | null
  pantryIngredients?: PantryIngredient[]
  pantryDeducted?: boolean
  preparationTips?: StructuredTips | null
  note?: string | null
}) {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <MealCard
        entryId="entry-1"
        planId="plan-1"
        mealType="dinner"
        status="planned"
        householdSize={4}
        {...props}
      />
    </Wrapper>,
  )
}

async function dismissSelector() {
  const dialog = await screen.findByRole('dialog')
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

describe('MealCard own-recipe icon', () => {
  it("marks the household's own recipe after its name, not in the badge row (HON-973)", () => {
    renderCard({ meal: { ...meal, isCustom: true } })

    const icon = screen.getByRole('button', { name: 'My recipe' })
    expect(icon).not.toHaveAttribute('title')
    expect(icon.closest('[data-slot="badge"]')).toBeNull()
    const heading = screen.getByRole('heading', { level: 3 })
    expect(heading).toContainElement(icon)
    // The name still opens the cook view as a button of its own, beside the
    // icon rather than around it.
    const name = screen.getByRole('button', { name: meal.name })
    expect(name).not.toContainElement(icon)
  })

  it('shows no icon for a library meal', () => {
    renderCard({ meal: { ...meal, isCustom: false } })

    expect(screen.queryByRole('button', { name: 'My recipe' })).not.toBeInTheDocument()
  })
})

// The selector opens from state with no `DialogTrigger`, so Radix alone would
// leave focus on the page body when it closes (HON-804).
describe('MealCard selector focus', () => {
  it('returns focus to the more-actions trigger when Swap is dismissed', async () => {
    const user = userEvent.setup()
    renderCard({ meal })

    const trigger = screen.getByRole('button', { name: `More actions: ${meal.name}` })
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: 'Swap' }))

    await dismissSelector()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('returns focus to "Add meal" when the selector is dismissed', async () => {
    const user = userEvent.setup()
    renderCard({ meal: null })

    const addMeal = screen.getByRole('button', { name: 'Add meal' })
    await user.click(addMeal)

    await dismissSelector()
    await waitFor(() => expect(addMeal).toHaveFocus())
  })
})

// Every household starts with salt, pepper and water as staples (HON-769), so a
// staples-only pantry is one the household has never filled in (HON-824).
// Closing the note editor hands focus to ⋯ so the textarea's unmount does not
// drop it to the body (HON-946), but a save closes the editor only when its
// request returns, and the user may have moved focus elsewhere by then.
describe('MealCard note focus', () => {
  async function openNoteFromMenu(user: ReturnType<typeof userEvent.setup>) {
    const trigger = screen.getByRole('button', { name: `More actions: ${meal.name}` })
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: 'Note' }))
    return { trigger, textarea: await screen.findByRole('textbox', { name: 'Meal note' }) }
  }

  it('returns focus to the more-actions trigger when the editor is cancelled', async () => {
    const user = userEvent.setup()
    renderCard({ meal })
    const { trigger, textarea } = await openNoteFromMenu(user)

    fireEvent.keyDown(textarea, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('returns focus to the saved note when the editor was opened from it', async () => {
    const user = userEvent.setup()
    renderCard({ meal, note: 'Leftovers' })
    await user.click(screen.getByRole('button', { name: 'Leftovers' }))
    const textarea = await screen.findByRole('textbox', { name: 'Meal note' })

    fireEvent.keyDown(textarea, { key: 'Escape' })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Leftovers' })).toHaveFocus())
  })

  // Clearing the note removes the row the note lived in, so there is no note
  // left to return to.
  it('falls back to the more-actions trigger when a saved note is cleared', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))),
    )
    const user = userEvent.setup()
    renderCard({ meal, note: 'Leftovers' })
    await user.click(screen.getByRole('button', { name: 'Leftovers' }))
    const textarea = await screen.findByRole('textbox', { name: 'Meal note' })
    await user.clear(textarea)

    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: `More actions: ${meal.name}` })).toHaveFocus(),
    )
  })

  it('leaves focus alone when the user moved on before the save returned', async () => {
    let resolveSave: (response: Response) => void = () => {}
    const fetchSuggestions = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        init?.method === 'PATCH'
          ? new Promise<Response>((resolve) => (resolveSave = resolve))
          : fetchSuggestions(url, init),
      ),
    )
    const user = userEvent.setup()
    renderCard({ meal })
    const { trigger, textarea } = await openNoteFromMenu(user)
    await user.type(textarea, 'Leftovers')
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/meal-plans/plan-1/entries/entry-1',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    )

    const name = screen.getByRole('button', { name: meal.name })
    name.focus()
    resolveSave(new Response(JSON.stringify({}), { status: 200 }))

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(name).toHaveFocus()
    expect(trigger).not.toHaveFocus()
  })
})

describe('MealCard availability badge', () => {
  const garlicStaple = { ingredientId: 'garlic', isStaple: true }

  it('shows no badge when the pantry holds only staples', () => {
    renderCard({ meal, pantryIngredients: [garlicStaple] })

    expect(screen.queryByText(/ingredients? to buy/)).not.toBeInTheDocument()
    expect(screen.queryByText('Have all ingredients')).not.toBeInTheDocument()
  })

  it('counts the missing ingredients once the pantry holds a non-staple', () => {
    renderCard({
      meal,
      pantryIngredients: [garlicStaple, { ingredientId: 'chicken-thigh', isStaple: false }],
    })

    // Potato and lemon: garlic is a staple, chicken is on hand.
    expect(screen.getByText('2 ingredients to buy')).toBeInTheDocument()
  })
})

// "Done cooking" in the cook view runs the status select's completion: the
// deduction preview (or a direct completion when already charged), then the
// rating prompt, with focus back on the card (HON-933).
describe('MealCard Done cooking', () => {
  const tips: StructuredTips = {
    equipment: [],
    steps: ['Roast the chicken'],
    pitfalls: [],
  }

  beforeEach(() => {
    vi.mocked(track).mockClear()
  })

  async function doneCooking(user: ReturnType<typeof userEvent.setup>) {
    const name = screen.getByRole('button', { name: meal.name })
    await user.click(name)
    await user.click(await screen.findByRole('button', { name: 'Done cooking' }))
    return name
  }

  it('closes the view, then confirms the deduction and asks for a rating', async () => {
    const user = userEvent.setup()
    renderCard({ meal, preparationTips: tips })

    const name = await doneCooking(user)
    const deduction = await screen.findByRole('dialog', { name: 'Mark as completed' })
    // Never stacked: the cook view is gone by the time the deduction opens.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    await user.click(within(deduction).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('How was it?')).toBeInTheDocument()
    await waitFor(() => expect(name).toHaveFocus())

    expect(fetch).toHaveBeenCalledWith(
      '/api/meal-plans/plan-1/entries/entry-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed', deductPantry: true }),
      }),
    )
    expect(track).toHaveBeenCalledWith('meal_plan:meal_completed', {
      plan_id: 'plan-1',
      meal_id: meal.id,
      source: 'cook_view',
    })
  })

  it('returns focus to the meal name when the deduction is cancelled', async () => {
    const user = userEvent.setup()
    renderCard({ meal, preparationTips: tips })

    const name = await doneCooking(user)
    const deduction = await screen.findByRole('dialog', { name: 'Mark as completed' })
    await user.click(within(deduction).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(name).toHaveFocus())
  })

  it('can be undone from the card menu on a day that is not past', async () => {
    const tipsUrl = '/api/meal-plans/plan-1/entries/entry-1/preparation-tips'
    const fresh: StructuredTips = {
      equipment: [],
      steps: ['Roast the chicken again'],
      pitfalls: [],
    }
    vi.mocked(fetch).mockImplementation((input) =>
      Promise.resolve(
        new Response(JSON.stringify(input === tipsUrl ? { tips: fresh } : { ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const user = userEvent.setup()
    renderCard({ meal, preparationTips: tips, pantryDeducted: true })

    await doneCooking(user)
    expect(await screen.findByText('How was it?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: `More actions: ${meal.name}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Not cooked yet' }))

    await waitFor(() => expect(screen.queryByText('How was it?')).not.toBeInTheDocument())
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/meal-plans/plan-1/entries/entry-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'planned', deductPantry: false }),
      }),
    )
    // Planned again: the cook view offers Done cooking once more. Leaving
    // `completed` nulled the cached tips server-side, so the view drops its
    // seeded copy and writes fresh steps rather than showing the old ones.
    await user.click(screen.getByRole('button', { name: meal.name }))
    expect(await screen.findByRole('button', { name: 'Done cooking' })).toBeInTheDocument()
    expect(await screen.findByText('Roast the chicken again')).toBeInTheDocument()
    expect(screen.queryByText('Roast the chicken')).not.toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === tipsUrl)).toHaveLength(1)
  })

  it('completes directly when the pantry was already charged', async () => {
    const user = userEvent.setup()
    renderCard({ meal, preparationTips: tips, pantryDeducted: true })

    await doneCooking(user)
    expect(await screen.findByText('How was it?')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Mark as completed' })).not.toBeInTheDocument()
  })
})

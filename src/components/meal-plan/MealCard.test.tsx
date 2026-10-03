import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest'
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
  status?: 'planned' | 'completed' | 'skipped'
  rating?: 'up' | 'down' | null
  isPast?: boolean
  pantryIngredients?: PantryIngredient[]
  pantryDeducted?: boolean
  preparationTips?: StructuredTips | null
  note?: string | null
  noteX?: number | null
  noteY?: number | null
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

async function openNoteFromMenu(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole('button', { name: `More actions: ${meal.name}` })
  await user.click(trigger)
  await user.click(await screen.findByRole('menuitem', { name: 'Note' }))
  return { trigger, textarea: await screen.findByRole('textbox', { name: 'Meal note' }) }
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

describe('MealCard note placement (HON-975)', () => {
  const overlay = () =>
    // eslint-disable-next-line testing-library/no-node-access -- the overlay is a positioning wrapper with no role
    document.querySelector<HTMLElement>('[data-slot="meal-image-overlay"]')!

  it('describes the slip as movable with the arrow keys', () => {
    renderCard({ meal, note: 'Leftovers' })

    expect(screen.getByRole('button', { name: 'Leftovers' })).toHaveAccessibleDescription(
      'Arrow keys move the note on the card.',
    )
  })

  it("rests the slip at the entry's own scatter", () => {
    renderCard({ meal, note: 'Leftovers' })

    expect(overlay()).not.toHaveAttribute('data-placed')
    // entry-1, pinned in note-placement.test.ts.
    expect(overlay().style.getPropertyValue('--note-x')).toBe('-2px')
    expect(overlay().style.getPropertyValue('--note-tilt')).toBe('-1.5deg')
  })

  it('lays the slip at its saved place', () => {
    renderCard({ meal, note: 'Leftovers', noteX: 0.1, noteY: 0.5 })

    expect(overlay()).toHaveAttribute('data-placed')
    expect(overlay().style.getPropertyValue('--note-left')).toBe('10%')
  })

  it('starts a note cleared and added again at the default place', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))),
    )
    const user = userEvent.setup()
    renderCard({ meal, note: 'Leftovers', noteX: 0.1, noteY: 0.5 })
    await user.click(screen.getByRole('button', { name: 'Leftovers' }))
    const textarea = await screen.findByRole('textbox', { name: 'Meal note' })
    await user.clear(textarea)
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())

    const { textarea: fresh } = await openNoteFromMenu(user)
    await user.type(fresh, 'Pizza night')
    fireEvent.keyDown(fresh, { key: 'Enter' })

    await screen.findByRole('button', { name: 'Pizza night' })
    expect(overlay()).not.toHaveAttribute('data-placed')
  })

  it('saves a keyboard move once the keys settle', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    try {
      renderCard({ meal, note: 'Leftovers' })
      const slip = screen.getByRole('button', { name: 'Leftovers' })

      // Arrow keys move the slip, not the page.
      expect(fireEvent.keyDown(slip, { key: 'ArrowLeft' })).toBe(false)
      fireEvent.keyDown(slip, { key: 'ArrowUp', shiftKey: true })
      vi.advanceTimersByTime(399)
      expect(fetchMock).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('/api/meal-plans/plan-1/entries/entry-1')
      expect(init.method).toBe('PATCH')
      const body = JSON.parse(init.body as string)
      expect(Object.keys(body).sort()).toEqual(['noteX', 'noteY'])
      expect(overlay()).toHaveAttribute('data-placed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('puts the slip back when its save fails', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'Failed' }), { status: 500 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    try {
      renderCard({ meal, note: 'Leftovers' })
      fireEvent.keyDown(screen.getByRole('button', { name: 'Leftovers' }), { key: 'ArrowLeft' })
      expect(overlay()).toHaveAttribute('data-placed')

      vi.advanceTimersByTime(400)

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(overlay()).not.toHaveAttribute('data-placed'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a later move when an earlier save fails', async () => {
    let failFirst: (response: Response) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (failFirst = resolve)))
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    try {
      renderCard({ meal, note: 'Leftovers' })
      const slip = screen.getByRole('button', { name: 'Leftovers' })
      fireEvent.keyDown(slip, { key: 'ArrowLeft' })
      vi.advanceTimersByTime(400)
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

      // The slip moves again while the first save is still out.
      fireEvent.keyDown(slip, { key: 'ArrowLeft' })
      failFirst(new Response(JSON.stringify({ error: 'Failed' }), { status: 500 }))
      vi.advanceTimersByTime(400)

      // The saves run in order, and the failed one does not undo the move.
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      expect(overlay()).toHaveAttribute('data-placed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps its place through an edit', async () => {
    const user = userEvent.setup()
    renderCard({ meal, note: 'Leftovers', noteX: 0.1, noteY: 0.5 })
    await user.click(screen.getByRole('button', { name: 'Leftovers' }))
    const textarea = await screen.findByRole('textbox', { name: 'Meal note' })
    // The editor's wide box is not the slip's place.
    expect(overlay()).not.toHaveAttribute('data-placed')

    fireEvent.keyDown(textarea, { key: 'Escape' })

    await screen.findByRole('button', { name: 'Leftovers' })
    expect(overlay()).toHaveAttribute('data-placed')
    expect(overlay().style.getPropertyValue('--note-left')).toBe('10%')
  })

  it('opens the editor on Enter, as before', async () => {
    renderCard({ meal, note: 'Leftovers' })
    const slip = screen.getByRole('button', { name: 'Leftovers' })
    slip.focus()

    await userEvent.setup().keyboard('{Enter}')

    expect(await screen.findByRole('textbox', { name: 'Meal note' })).toBeInTheDocument()
  })

  it("leaves a past card's slip inert, at its scatter", () => {
    const { wrapper: Wrapper } = createQueryWrapper()
    render(
      <Wrapper>
        <MealCard
          entryId="entry-1"
          planId="plan-1"
          meal={meal}
          mealType="dinner"
          status="planned"
          householdSize={4}
          isPast
          note="Leftovers"
        />
      </Wrapper>,
    )

    expect(screen.queryByRole('button', { name: 'Leftovers' })).not.toBeInTheDocument()
    expect(overlay().style.getPropertyValue('--note-tilt')).toBe('-1.5deg')
  })
})

describe('MealCard card click (HON-1010)', () => {
  const tips: StructuredTips = { equipment: [], steps: ['Roast the chicken'], pitfalls: [] }
  const description = 'Crisp skin, soft potatoes.'
  const imageMeal = {
    ...meal,
    description,
    imageStatus: 'ready' as const,
    imageUrl: 'https://store.public.blob.vercel-storage.com/meals/meal-1.png',
    imageHue: 40,
  }

  const card = () =>
    // eslint-disable-next-line testing-library/no-node-access -- the card root has no role: the click is a pointer shortcut
    document.querySelector<HTMLElement>('[data-slot="card"]')!
  const cookView = () => screen.queryByRole('dialog', { name: meal.name })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the cook view from the plate, the description and the card body', async () => {
    const user = userEvent.setup()
    renderCard({ meal: imageMeal, preparationTips: tips })

    for (const target of [
      () => screen.getByTestId('meal-card-image'),
      () => screen.getByText(description),
      card,
    ]) {
      await user.click(target())
      expect(await screen.findByRole('dialog', { name: meal.name })).toBeInTheDocument()
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      await waitFor(() => expect(cookView()).not.toBeInTheDocument())
    }
  })

  it('returns focus to the name when a view opened by a card click closes', async () => {
    const user = userEvent.setup()
    renderCard({ meal: imageMeal, preparationTips: tips })

    await user.click(screen.getByTestId('meal-card-image'))
    await screen.findByRole('dialog', { name: meal.name })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(cookView()).not.toBeInTheDocument())

    expect(screen.getByRole('button', { name: meal.name })).toHaveFocus()
  })

  it('opens the cook view from a past card', async () => {
    const user = userEvent.setup()
    renderCard({ meal: imageMeal, isPast: true, preparationTips: tips })

    await user.click(screen.getByTestId('meal-card-image'))
    expect(await screen.findByRole('dialog', { name: meal.name })).toBeInTheDocument()
  })

  it('marks the card interactive and the name as its keyboard target', () => {
    renderCard({ meal })
    const name = screen.getByRole('button', { name: meal.name })

    expect(card()).toHaveClass('group/card', 'cursor-pointer', 'hover:border-muted-foreground')
    expect(card()).not.toHaveAttribute('tabindex')
    expect(card()).not.toHaveAttribute('role')
    expect(name).toHaveAttribute('data-slot', 'card-target')
    expect(name).toHaveClass('outline-none')
  })

  it('opens the cook view once from the name, with Enter and with Space', async () => {
    const user = userEvent.setup()
    renderCard({ meal, preparationTips: tips })
    const name = screen.getByRole('button', { name: meal.name })

    for (const key of ['{Enter}', ' ']) {
      name.focus()
      await user.keyboard(key)
      expect(await screen.findAllByRole('dialog', { name: meal.name })).toHaveLength(1)
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      await waitFor(() => expect(cookView()).not.toBeInTheDocument())
    }
  })

  it('leaves the ⋯ menu and its items to themselves', async () => {
    const user = userEvent.setup()
    renderCard({ meal })

    await user.click(screen.getByRole('button', { name: `More actions: ${meal.name}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Swap' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(cookView()).not.toBeInTheDocument()
  })

  it('only closes the open ⋯ menu on a press on the card', async () => {
    const user = userEvent.setup()
    renderCard({ meal: imageMeal, preparationTips: tips })
    const trigger = screen.getByRole('button', { name: `More actions: ${meal.name}` })
    await user.click(trigger)
    await screen.findByRole('menu')

    await user.click(screen.getByTestId('meal-card-image'))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(cookView()).not.toBeInTheDocument()

    // The next press is a card click again.
    await user.click(screen.getByTestId('meal-card-image'))
    expect(await screen.findByRole('dialog', { name: meal.name })).toBeInTheDocument()
  })

  it('leaves the rating badge and the rating prompt to themselves', async () => {
    const user = userEvent.setup()
    renderCard({ meal, status: 'completed', rating: 'up' })

    await user.click(screen.getByRole('button', { name: /^Rating:/ }))
    expect(await screen.findByText('How was it?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss rating' }))

    expect(cookView()).not.toBeInTheDocument()
  })

  it("leaves a past card's status control to itself", async () => {
    // Radix Select reads the pointer-capture and scroll APIs jsdom lacks.
    // Defined on the instances' prototype for this test only: the note-drag
    // tests above rely on `setPointerCapture` being absent.
    const proto = Element.prototype as Partial<Element>
    const stubs = {
      hasPointerCapture: () => false,
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      scrollIntoView: () => {},
    }
    const missing = Object.entries(stubs).filter(([key]) => !(key in proto))
    for (const [key, fn] of missing) {
      Object.defineProperty(proto, key, { value: fn, configurable: true, writable: true })
    }
    onTestFinished(() => {
      for (const [key] of missing) delete (proto as Record<string, unknown>)[key]
    })
    const user = userEvent.setup()
    renderCard({ meal, isPast: true })

    await user.click(screen.getByRole('combobox', { name: 'Meal status' }))
    await user.click(await screen.findByRole('option', { name: /skipped/i }))

    expect(cookView()).not.toBeInTheDocument()
  })

  it('opens the note editor from the slip, not the cook view', async () => {
    const user = userEvent.setup()
    renderCard({ meal: imageMeal, note: 'Leftovers' })

    await user.click(screen.getByRole('button', { name: 'Leftovers' }))

    expect(await screen.findByRole('textbox', { name: 'Meal note' })).toBeInTheDocument()
    expect(cookView()).not.toBeInTheDocument()
  })

  it('leaves a click that ends a text selection alone', async () => {
    const user = userEvent.setup()
    renderCard({ meal: imageMeal })
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Crisp skin',
    } as Selection)

    await user.click(screen.getByText(description))

    expect(cookView()).not.toBeInTheDocument()
  })

  it('gives the empty slot no card click', async () => {
    const user = userEvent.setup()
    renderCard({ meal: null })

    await user.click(card())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(card()).not.toHaveClass('cursor-pointer')
  })
})

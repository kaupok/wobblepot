import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MealDetailModal } from './MealDetailModal'
import type { EntryChange, MealData, PreparationSteps } from './types'

// The cook view with an entry's own ingredient changes (HON-1243), with the
// real `MealDetail`, `useMealSteps` and `useEntryChanges`.

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
vi.mock('@/hooks/use-meal-image', () => ({
  useMealImage: () => ({ status: 'none', imageUrl: null, imageHue: null, cancelImage: vi.fn() }),
}))
vi.mock('@/hooks/use-wake-lock', () => ({ useWakeLock: () => {} }))
vi.mock('./NoteEditor', () => ({ NoteEditor: () => null }))
vi.mock('./MealImage', () => ({ MealImage: () => null }))

const ingredient = (id: string, name: string) => ({
  id,
  name,
  category: 'dairy',
  defaultUnit: 'g' as const,
})

// Merged, as the server sends it: yoghurt where the cream was.
const meal: MealData = {
  id: 'meal-1',
  name: 'Pasta bake',
  kidFriendly: false,
  components: [
    { ingredientId: 'pasta', quantityPerServing: 100, ingredient: ingredient('pasta', 'Pasta') },
    {
      ingredientId: 'yoghurt',
      quantityPerServing: 60,
      ingredient: ingredient('yoghurt', 'Yoghurt'),
    },
  ],
  nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 },
}

const changes: EntryChange[] = [
  {
    id: 'change-1',
    original: { id: 'cream', name: 'Cream' },
    replacement: { id: 'yoghurt', name: 'Yoghurt' },
    quantityPerServing: 60,
    stale: false,
  },
]

const cachedTips: PreparationSteps = { steps: ['Boil the pasta'], pitfalls: [] }

const TIPS_URL = '/api/meal-plans/plan-1/entries/entry-1/preparation-tips'
const UNDO_URL = '/api/meal-plans/plan-1/entries/entry-1/components/change-1'

let fetchMock: ReturnType<typeof vi.fn>
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const callsTo = (url: string) => fetchMock.mock.calls.filter(([called]) => called === url)

beforeEach(() => {
  refresh.mockClear()
  fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      url === TIPS_URL ? json({ tips: { steps: ['Bake it'], pitfalls: [] } }) : json({}),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderModal(props: Partial<React.ComponentProps<typeof MealDetailModal>> = {}) {
  const { wrapper } = createQueryWrapper()
  return render(
    <MealDetailModal
      meal={meal}
      householdServings={2}
      status="planned"
      open
      onOpenChange={vi.fn()}
      planId="plan-1"
      entryId="entry-1"
      changes={changes}
      initialSteps={cachedTips}
      generateOnOpen
      onDoneCooking={vi.fn()}
      {...props}
    />,
    { wrapper },
  )
}

describe('MealDetailModal with ingredient changes (HON-1243)', () => {
  it('lists the changes by the ingredients and above the steps, with the controls', () => {
    renderModal()

    expect(screen.getByText('Instead of Cream')).toBeInTheDocument()
    expect(screen.getByText('Replaced: Cream → Yoghurt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo change: Yoghurt' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change Pasta' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add an ingredient' })).toBeInTheDocument()
  })

  it.each([
    ['completed', { status: 'completed' as const, onDoneCooking: undefined }],
    ['skipped', { status: 'skipped' as const, onDoneCooking: undefined }],
  ])('shows a %s entry’s changes without any control', (_status, props) => {
    renderModal({ ...props, generateOnOpen: false })

    expect(screen.getByText('Instead of Cream')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Undo change/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Change / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add an ingredient' })).not.toBeInTheDocument()
  })

  it('regenerates the steps after an undo, and refreshes the plan', async () => {
    renderModal()
    expect(screen.getByText('Boil the pasta')).toBeInTheDocument()
    expect(callsTo(TIPS_URL)).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Undo change: Yoghurt' }))

    await waitFor(() => expect(callsTo(TIPS_URL)).toHaveLength(1))
    expect(callsTo(UNDO_URL)).toEqual([[UNDO_URL, { method: 'DELETE' }]])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Bake it')).toBeInTheDocument()
  })

  // "Make it my recipe" (HON-1245) sits with the ingredient controls, so only
  // a planned, editable entry gets it; saving drops the cached steps.
  it('keeps the changes as a recipe, then regenerates the steps and refreshes the plan', async () => {
    const PROMOTE_URL = '/api/meal-plans/plan-1/entries/entry-1/components/promote'
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === TIPS_URL
          ? json({ tips: { steps: ['Bake it'], pitfalls: [] } })
          : json({ outcome: 'forked', mealId: 'meal-new' }),
      ),
    )
    renderModal()

    await userEvent.click(screen.getByRole('button', { name: 'Make it my recipe' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save to My recipes' }))

    await waitFor(() => expect(callsTo(TIPS_URL)).toHaveLength(1))
    expect(callsTo(PROMOTE_URL)).toHaveLength(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('offers "Update the recipe" on the household\'s own recipe', () => {
    renderModal({ meal: { ...meal, isCustom: true }, generateOnOpen: false })

    expect(screen.getByRole('button', { name: 'Update the recipe' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make it my recipe' })).not.toBeInTheDocument()
  })

  it('offers no action on a completed entry', () => {
    renderModal({ status: 'completed', onDoneCooking: undefined, generateOnOpen: false })

    expect(screen.queryByRole('button', { name: 'Make it my recipe' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update the recipe' })).not.toBeInTheDocument()
  })
})

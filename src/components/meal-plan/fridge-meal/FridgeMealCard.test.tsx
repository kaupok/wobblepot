import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { createQueryWrapper } from '@/test/query-wrapper'
import { fridgeItems, fridgePantryItems } from '@/stories/fridge-fixtures'
import { FridgeMealCard } from './FridgeMealCard'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const ENTRY_URL = '/api/meal-plans/plan-1/entries/entry-1'
let requests: { method: string; url: string; body: unknown }[]

beforeEach(() => {
  requests = []
  refresh.mockClear()
  vi.mocked(toast).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      const body =
        method === 'PATCH' ? { id: 'entry-1', pantryDeducted: true } : { success: true, meals: [] }
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderCard(
  props: {
    status?: 'planned' | 'completed'
    items?: typeof fridgeItems
    pantryDeducted?: boolean
  } = {},
) {
  const onCleared = vi.fn()
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <FridgeMealCard
        entryId="entry-1"
        planId="plan-1"
        date="2026-10-21"
        mealType="dinner"
        status={props.status ?? 'planned'}
        items={props.items ?? fridgeItems}
        note="Heat the mash first"
        pantryItems={fridgePantryItems}
        pantryDeducted={props.pantryDeducted}
        onCleared={onCleared}
      />
    </Wrapper>,
  )
  return { onCleared, user: userEvent.setup() }
}

const patches = () => requests.filter((r) => r.method === 'PATCH')

describe('FridgeMealCard', () => {
  it('shows the title and every item, and no rating, tips or cook-question controls', () => {
    renderCard({ status: 'completed' })

    expect(screen.getByRole('heading', { name: 'Fridge meal' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Mash, from Tuesday',
      'Cauliflower and broccoli mix',
      'Cucumber',
      'store meatballs',
    ])
    expect(screen.queryByText('How was it?')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /thumbs|rate/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /tips|cook|steps|ask/i })).not.toBeInTheDocument()
  })

  it('completes with the ticked pantry item through the dialog', async () => {
    const { user } = renderCard()

    await user.click(screen.getByRole('button', { name: 'Eaten' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Did you use anything up?' }))
    await user.click(dialog.getByRole('checkbox', { name: 'Used it all: Cucumber' }))
    await user.click(dialog.getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(patches()).toEqual([
      {
        method: 'PATCH',
        url: ENTRY_URL,
        body: { status: 'completed', deductPantry: false, usedUpIngredientIds: ['cucumber'] },
      },
    ])
    expect(screen.getByRole('button', { name: 'Not eaten yet' })).toHaveFocus()
  })

  it('completes with no dialog when no item is from the pantry', async () => {
    const { user } = renderCard({ items: fridgeItems.filter((i) => i.ingredientId === null) })

    await user.click(screen.getByRole('button', { name: 'Eaten' }))

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0]!.body).toEqual({ status: 'completed', deductPantry: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('completes with no dialog when the pantry was marked once already', async () => {
    const { user } = renderCard({ pantryDeducted: true })

    await user.click(screen.getByRole('button', { name: 'Eaten' }))

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reverts a completed fridge meal and offers no edit or clear on it', async () => {
    const { user } = renderCard({ status: 'completed' })

    expect(screen.queryByRole('button', { name: 'Edit items' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Not eaten yet' }))

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0]!.body).toEqual({ status: 'planned', deductPantry: false })
  })

  it('opens the picker on its items from "Edit items"', async () => {
    const { user } = renderCard()

    await user.click(screen.getByRole('button', { name: 'Edit items' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Fridge meal' }))
    expect(dialog.getByRole('button', { name: 'Remove: Cucumber' })).toBeInTheDocument()
  })

  it('clears the entry, and Undo posts the items and the note back', async () => {
    const { onCleared, user } = renderCard()

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1))
    expect(requests).toContainEqual({ method: 'DELETE', url: ENTRY_URL, body: null })
    const [message, options] = vi.mocked(toast).mock.calls[0]!
    expect(message).toBe('Cleared: Fridge meal')
    const action = options?.action as { onClick: (e: unknown) => void }
    action.onClick({})

    await waitFor(() => expect(requests.some((r) => r.method === 'POST')).toBe(true))
    expect(requests.find((r) => r.method === 'POST')).toEqual({
      method: 'POST',
      url: '/api/meal-plans/plan-1/entries',
      body: {
        date: '2026-10-21',
        mealType: 'dinner',
        fridgeItems: [
          { sourceEntryId: 'entry-mash' },
          { ingredientId: 'veg-mix' },
          { ingredientId: 'cucumber' },
          { label: 'store meatballs' },
        ],
        note: 'Heat the mash first',
        noteX: null,
        noteY: null,
      },
    })
  })
})

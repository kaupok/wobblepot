import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { fridgeItems, fridgePantryItems } from '@/stories/fridge-fixtures'
import type { FridgeMealItem, MealStatus } from '@/components/meal-plan/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { toast } from 'sonner'
import { PastFridgeRow } from './PastFridgeRow'

const fetchMock = vi.fn()
const wolt: FridgeMealItem[] = [
  {
    id: 'i-wolt',
    ingredientId: null,
    sourceEntryId: null,
    label: 'Wolt',
    name: null,
    sourceDate: null,
    servings: null,
  },
]

function respond(status: number, body: object = {}) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function renderRow(
  props: {
    status?: MealStatus
    items?: FridgeMealItem[]
    pantryDeducted?: boolean
    onCleared?: () => void
  } = {},
) {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <PastFridgeRow
        entryId="entry-1"
        planId="plan-1"
        date="2026-04-13"
        mealType="dinner"
        items={fridgeItems}
        status="planned"
        pantryItems={fridgePantryItems}
        {...props}
      />
    </Wrapper>,
  )
  return userEvent.setup()
}

const cooked = () => screen.getByRole('button', { name: 'Cooked' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PastFridgeRow', () => {
  it('names the row by its items, with Cooked, Skipped and Remove while planned', () => {
    renderRow({ items: wolt })

    expect(screen.getByText('Dinner, Fridge meal')).toBeInTheDocument()
    expect(screen.getByText('Wolt')).toBeInTheDocument()
    expect(cooked()).toHaveAccessibleDescription('Wolt')
    expect(screen.getByRole('button', { name: 'Skipped' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveAccessibleDescription('Wolt')
  })

  it('opens the fridge meal completion dialog on Cooked, and focuses Undo after Done', async () => {
    const user = renderRow()

    await user.click(cooked())
    await screen.findByRole('dialog', { name: 'Did you use anything up?' })
    expect(fetchMock).not.toHaveBeenCalled()

    respond(200, { pantryDeducted: true })
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: /^Undo: / })).toHaveFocus())
  })

  it('completes at once when no item is from the pantry', async () => {
    const user = renderRow({ items: wolt })

    respond(200)
    await user.click(cooked())

    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo: Wolt' })).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ status: 'completed' })
  })

  it('shows Cooked and Undo, with no Remove, once cooked', () => {
    renderRow({ items: wolt, status: 'completed' })

    expect(screen.getByText('Cooked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo: Wolt' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('removes a skipped fridge meal with its items for Undo', async () => {
    const onCleared = vi.fn()
    const user = renderRow({ items: wolt, status: 'skipped', onCleared })

    respond(200, { success: true })
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/meal-plans/plan-1/entries/entry-1',
      expect.objectContaining({ method: 'DELETE' }),
    )

    // Undo in the toast posts the meal back as it was: skipped, not planned.
    const [, options] = vi.mocked(toast).mock.calls[0]!
    respond(200, { id: 'restored' })
    ;(options as unknown as { action: { onClick: () => void } }).action.onClick()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[1]!
    expect(url).toBe('/api/meal-plans/plan-1/entries')
    expect(JSON.parse(init.body)).toEqual({
      date: '2026-04-13',
      mealType: 'dinner',
      fridgeItems: [{ label: 'Wolt' }],
      status: 'skipped',
      note: null,
      noteX: null,
      noteY: null,
    })
  })
})

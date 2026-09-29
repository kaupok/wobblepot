import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MealDetailModal } from './MealDetailModal'
import type { MealData } from './types'

const cancelTips = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/hooks/use-meal-tips', () => ({
  useMealTips: () => ({
    tips: null,
    isLoadingTips: false,
    tipsError: null,
    isTipsExpanded: false,
    fetchTips: vi.fn(),
    handleHowToPrepare: vi.fn(),
    hideTips: vi.fn(),
    cancelTips,
  }),
}))
vi.mock('@/hooks/use-meal-image', () => ({
  useMealImage: () => ({ status: 'none', imageUrl: null, imageHue: null, cancelImage: vi.fn() }),
}))
vi.mock('./NoteEditor', () => ({ NoteEditor: () => null }))
vi.mock('./MealImage', () => ({ MealImage: () => null }))

/**
 * `MealDetail` is replaced with a probe that renders the servings it is handed
 * and hands its `onServingsChange` back to the test, so the modal's optimistic
 * update and its `Promise<boolean>` contract are exercised without driving the
 * whole serving control.
 */
let onServingsChange: ((servings: number | null) => Promise<boolean>) | undefined
vi.mock('./MealDetail', () => ({
  MealDetail: (props: {
    servings: number
    onServingsChange?: (servings: number | null) => Promise<boolean>
  }) => {
    onServingsChange = props.onServingsChange
    return <output aria-label="servings">{props.servings}</output>
  },
}))

const meal: MealData = {
  id: 'meal-1',
  name: 'Lentil soup',
  kidFriendly: true,
  components: [],
  nutrition: {} as MealData['nutrition'],
}

function renderModal(onServingOverrideChange = vi.fn()) {
  const { wrapper } = createQueryWrapper()
  render(
    <MealDetailModal
      meal={meal}
      householdSize={4}
      open
      onOpenChange={vi.fn()}
      planId="plan-1"
      entryId="entry-1"
      servingOverride={null}
      onServingOverrideChange={onServingOverrideChange}
    />,
    { wrapper },
  )
  return { onServingOverrideChange }
}

function respondWith(status: number, body: unknown = {}) {
  let resolve!: () => void
  const settled = new Promise<void>((r) => (resolve = r))
  const fetchMock = vi.fn(() =>
    settled.then(() => ({ ok: status < 400, status, json: () => Promise.resolve(body) })),
  )
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, respond: resolve }
}

describe('MealDetailModal servings update', () => {
  beforeEach(() => {
    onServingsChange = undefined
    cancelTips.mockClear()
    vi.mocked(toast.error).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the new count optimistically and rolls it back when the PATCH fails', async () => {
    const { fetchMock, respond } = respondWith(500, { error: 'Failed to update entry' })
    const { onServingOverrideChange } = renderModal()
    expect(screen.getByLabelText('servings')).toHaveTextContent('4')

    let result!: Promise<boolean>
    act(() => {
      result = onServingsChange!(6)
    })
    expect(await screen.findByLabelText('servings')).toHaveTextContent('6')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/meal-plans/plan-1/entries/entry-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ servingOverride: 6 }) }),
    )

    respond()
    await act(async () => {
      await expect(result).resolves.toBe(false)
    })

    expect(screen.getByLabelText('servings')).toHaveTextContent('4')
    expect(toast.error).toHaveBeenCalledWith('Failed to update servings')
    expect(onServingOverrideChange).not.toHaveBeenCalled()
    expect(cancelTips).not.toHaveBeenCalled()
  })

  it('keeps the new count, notifies the parent and drops stale tips on success', async () => {
    const { respond } = respondWith(200, { id: 'entry-1', servingOverride: 6 })
    const { onServingOverrideChange } = renderModal()

    let result!: Promise<boolean>
    act(() => {
      result = onServingsChange!(6)
    })
    respond()
    await act(async () => {
      await expect(result).resolves.toBe(true)
    })

    expect(screen.getByLabelText('servings')).toHaveTextContent('6')
    expect(onServingOverrideChange).toHaveBeenCalledWith(6)
    expect(cancelTips).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })
})

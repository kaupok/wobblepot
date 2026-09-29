import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '@/test/query-wrapper'
import { TimelineEmptySlot } from './TimelineEmptySlot'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

// The real `useMealAlternatives` stays in: its suggestions query is what sent
// the extra request (HON-799). Only the list is stubbed, down to a button that
// hands the modal a meal id, so a pick needs no suggestion fixtures.
vi.mock('@/components/meal-plan/meal-selector/AlternativesList', () => ({
  AlternativesList: ({ onSelect }: { onSelect: (mealId: string) => void }) => (
    <button onClick={() => onSelect('meal-2')}>pick meal</button>
  ),
}))

const PLAN_ID = 'plan-1'
const ENTRY_ID = 'entry-1'
const ENTRY_URL = `/api/meal-plans/${PLAN_ID}/entries/${ENTRY_ID}`

interface Deferred {
  promise: Promise<Response>
  resolve: (res: Response) => void
  reject: (err: Error) => void
}

function deferred(): Deferred {
  let resolve!: Deferred['resolve']
  let reject!: Deferred['reject']
  const promise = new Promise<Response>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let requests: { method: string; url: string }[]
let deleteResponse: Deferred

beforeEach(() => {
  requests = []
  deleteResponse = deferred()
  refresh.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url })
      if (method === 'POST' && url === `/api/meal-plans/${PLAN_ID}/entries`) {
        return Promise.resolve(json({ id: ENTRY_ID }))
      }
      if (method === 'POST' && url === `${ENTRY_URL}/suggestions`) {
        return Promise.resolve(json({ suggestions: [] }))
      }
      if (method === 'PATCH' && url === ENTRY_URL) {
        return Promise.resolve(json({ id: ENTRY_ID }))
      }
      if (method === 'DELETE' && url === ENTRY_URL) {
        return deleteResponse.promise
      }
      return Promise.reject(new Error(`unexpected ${method} ${url}`))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderSlot() {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <TimelineEmptySlot planId={PLAN_ID} date="2026-04-16" mealType="dinner" householdSize={4} />
    </Wrapper>,
  )
}

async function openSelector() {
  fireEvent.click(screen.getByRole('button', { name: 'Pick a meal' }))
  await screen.findByRole('dialog')
  await waitFor(() => expect(suggestionRequests()).toHaveLength(1))
}

function closeSelector() {
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
}

const suggestionRequests = () => requests.filter((r) => r.url === `${ENTRY_URL}/suggestions`)
const deleteRequests = () => requests.filter((r) => r.method === 'DELETE')

describe('TimelineEmptySlot', () => {
  it('discards the placeholder without asking for its suggestions again', async () => {
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(deleteRequests()).toHaveLength(1))
    expect(deleteRequests()[0]?.url).toBe(ENTRY_URL)

    deleteResponse.resolve(json({ success: true }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pick a meal' })).toBeEnabled())

    expect(suggestionRequests()).toHaveLength(1)
    const deleteIndex = requests.findIndex((r) => r.method === 'DELETE')
    expect(requests.slice(deleteIndex + 1).filter((r) => r.url.startsWith(ENTRY_URL))).toEqual([])
  })

  it('closes the selector before the discard finishes', async () => {
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteRequests()).toHaveLength(1)
  })

  it('disables "Pick a meal" while the placeholder is being discarded', async () => {
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(deleteRequests()).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Pick a meal' })).toBeDisabled()

    deleteResponse.resolve(json({ success: true }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pick a meal' })).toBeEnabled())
  })

  it('keeps the entry when a meal was picked', async () => {
    renderSlot()
    await openSelector()

    fireEvent.click(screen.getByRole('button', { name: 'pick meal' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(requests.some((r) => r.method === 'PATCH' && r.url === ENTRY_URL)).toBe(true)
    expect(deleteRequests()).toEqual([])
  })

  it('ignores an error status from the discard', async () => {
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(deleteRequests()).toHaveLength(1))
    deleteResponse.resolve(json({ error: 'boom' }, 500))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Pick a meal' })).toBeEnabled())
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes the page when the discard fails on the network', async () => {
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(deleteRequests()).toHaveLength(1))
    deleteResponse.reject(new TypeError('Failed to fetch'))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
const PICK_NAME = 'Pick a meal: Thursday Apr 16, Dinner'
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
let createResponse: Deferred | null
let deleteResponse: Deferred

beforeEach(() => {
  requests = []
  createResponse = null
  deleteResponse = deferred()
  refresh.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url })
      if (method === 'POST' && url === `/api/meal-plans/${PLAN_ID}/entries`) {
        return createResponse ? createResponse.promise : Promise.resolve(json({ id: ENTRY_ID }))
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
      <TimelineEmptySlot
        planId={PLAN_ID}
        date="2026-04-16"
        dayLabel="Thursday Apr 16"
        mealType="dinner"
        householdSize={4}
      />
    </Wrapper>,
  )
}

async function openSelector() {
  fireEvent.click(pickButton())
  await screen.findByRole('dialog')
  await waitFor(() => expect(suggestionRequests()).toHaveLength(1))
}

function closeSelector() {
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
}

// "Pick a meal" is `aria-disabled`, not `disabled`, while a create or discard
// is pending (HON-803), so `toBeDisabled()` cannot see it.
function expectPending(button: HTMLElement) {
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).toBeEnabled()
}

function expectIdle(button: HTMLElement) {
  expect(button).not.toHaveAttribute('aria-disabled')
}

const pickButton = () => screen.getByRole('button', { name: PICK_NAME })
const createRequests = () =>
  requests.filter((r) => r.method === 'POST' && r.url === `/api/meal-plans/${PLAN_ID}/entries`)
const suggestionRequests = () => requests.filter((r) => r.url === `${ENTRY_URL}/suggestions`)
const deleteRequests = () => requests.filter((r) => r.method === 'DELETE')

describe('TimelineEmptySlot', () => {
  // Today renders one of these per empty slot, so the name has to say which
  // one, and start with the visible text (WCAG 2.5.3) (HON-807).
  it('names the day and meal after the visible text', () => {
    renderSlot()
    const button = pickButton()
    expect(button).toHaveTextContent('Pick a meal')
    expect(button).toHaveAccessibleName(PICK_NAME)
  })

  it('keeps the day and meal in the name while the placeholder is being created', async () => {
    createResponse = deferred()
    renderSlot()

    fireEvent.click(pickButton())
    const adding = await screen.findByRole('button', {
      name: 'Adding…: Thursday Apr 16, Dinner',
    })
    expect(adding).toHaveTextContent('Adding…')

    createResponse.resolve(json({ id: ENTRY_ID }))
    await screen.findByRole('dialog')
  })

  it('names the slot in the selector description', async () => {
    renderSlot()
    await openSelector()

    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Thursday Apr 16 · Dinner')
  })

  it('discards the placeholder without asking for its suggestions again', async () => {
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(deleteRequests()).toHaveLength(1))
    expect(deleteRequests()[0]?.url).toBe(ENTRY_URL)

    deleteResponse.resolve(json({ success: true }))
    await waitFor(() => expectIdle(pickButton()))

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
    expectPending(pickButton())

    deleteResponse.resolve(json({ success: true }))
    await waitFor(() => expectIdle(pickButton()))
  })

  it('ignores a second activation while the placeholder is being created', async () => {
    const user = userEvent.setup()
    createResponse = deferred()
    renderSlot()

    fireEvent.click(pickButton())
    const adding = await screen.findByRole('button', { name: /^Adding…/ })
    expectPending(adding)

    // `pointer-events-none` is CSS, which jsdom does not apply, so a click here
    // reaches the handler the way Enter and Space do in a browser.
    fireEvent.click(adding)
    adding.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(createRequests()).toHaveLength(1)

    createResponse.resolve(json({ id: ENTRY_ID }))
    await screen.findByRole('dialog')
    expect(createRequests()).toHaveLength(1)
  })

  it('ignores a second activation while the placeholder is being discarded', async () => {
    const user = userEvent.setup()
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(deleteRequests()).toHaveLength(1))
    const button = pickButton()
    expectPending(button)

    fireEvent.click(button)
    button.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(createRequests()).toHaveLength(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    deleteResponse.resolve(json({ success: true }))
    await waitFor(() => expectIdle(pickButton()))
  })

  it('returns focus to "Pick a meal" when the selector closes without a pick', async () => {
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Still pending: the discard has not settled, and focus lands anyway.
    expectPending(pickButton())
    await waitFor(() => expect(pickButton()).toHaveFocus())
  })

  it('keeps "Pick a meal" focusable while it is pending', async () => {
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(deleteRequests()).toHaveLength(1))
    const button = pickButton()
    button.focus()
    expect(button).toHaveFocus()
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

    await waitFor(() => expectIdle(pickButton()))
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

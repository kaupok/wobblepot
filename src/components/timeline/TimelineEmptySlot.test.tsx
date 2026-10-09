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
const PICK_NAME = 'Dinner: pick a meal, Thursday Apr 16'
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

function renderSlot(props: { autoFocus?: boolean; onAutoFocused?: () => void } = {}) {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <TimelineEmptySlot
        planId={PLAN_ID}
        date="2026-04-16"
        dayLabel="Thursday Apr 16"
        mealType="dinner"
        householdServings={4}
        {...props}
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

// The slot's button is `aria-disabled`, not `disabled`, while a create or discard
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
  // Every empty day has a "Dinner" button, so the name has to say which day,
  // and start with the visible text (WCAG 2.5.3) (HON-807, HON-1111).
  it('shows the meal type and names the day after it', () => {
    renderSlot()
    const button = pickButton()
    expect(button).toHaveTextContent(/^Dinner$/)
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

  // The selector's title names the slot from its date, long and short forms
  // both in the DOM; CSS shows one (HON-941).
  it('names the slot in the selector title', async () => {
    renderSlot()
    await openSelector()

    const title = screen.getByRole('heading')
    expect(title).toHaveTextContent('Dinner for Thu Apr 16')
    expect(title).toHaveTextContent('Pick a dinner for Thursday Apr 16')
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby')
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

  it('disables the button while the placeholder is being discarded', async () => {
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

  it('returns focus to the button when the selector closes without a pick', async () => {
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Still pending: the discard has not settled, and focus lands anyway.
    expectPending(pickButton())
    await waitFor(() => expect(pickButton()).toHaveFocus())
  })

  it('keeps the button focusable while it is pending', async () => {
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

  // The slot replaces a card whose meal was just cleared (HON-1123).
  describe('autoFocus', () => {
    it('takes focus from the page body as it mounts', () => {
      const onAutoFocused = vi.fn()
      renderSlot({ autoFocus: true, onAutoFocused })

      expect(pickButton()).toHaveFocus()
      expect(onAutoFocused).toHaveBeenCalledTimes(1)
    })

    it('leaves focus where the user moved it', () => {
      const elsewhere = document.createElement('button')
      document.body.append(elsewhere)
      elsewhere.focus()
      const onAutoFocused = vi.fn()

      renderSlot({ autoFocus: true, onAutoFocused })

      expect(elsewhere).toHaveFocus()
      expect(onAutoFocused).toHaveBeenCalledTimes(1)
      elsewhere.remove()
    })

    it('takes no focus without it', () => {
      renderSlot()

      expect(pickButton()).not.toHaveFocus()
    })
  })
})

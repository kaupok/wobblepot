import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MealType } from '@/generated/prisma/enums'
import { createQueryWrapper } from '@/test/query-wrapper'

import { DayAddMenu } from './DayAddMenu'

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
const ADD_NAME = 'Add to Thursday Apr 16'
const ENTRY_ID = 'entry-1'
const ENTRY_URL = `/api/meal-plans/${PLAN_ID}/entries/${ENTRY_ID}`
// The discard deletes the entry only while it is still a placeholder (HON-1251).
const DISCARD_URL = `${ENTRY_URL}?placeholder`

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

let requests: { method: string; url: string; keepalive?: boolean }[]
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
      requests.push({ method, url, keepalive: init?.keepalive })
      if (method === 'POST' && url === `/api/meal-plans/${PLAN_ID}/entries`) {
        return createResponse ? createResponse.promise : Promise.resolve(json({ id: ENTRY_ID }))
      }
      if (method === 'POST' && url === `${ENTRY_URL}/suggestions`) {
        return Promise.resolve(json({ suggestions: [] }))
      }
      if (method === 'PATCH' && url === ENTRY_URL) {
        return Promise.resolve(json({ id: ENTRY_ID }))
      }
      if (method === 'DELETE' && url === DISCARD_URL) {
        return deleteResponse.promise
      }
      return Promise.reject(new Error(`unexpected ${method} ${url}`))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderSlot(props: { focusSlot?: MealType; onSlotFocused?: () => void } = {}) {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <DayAddMenu
        planId={PLAN_ID}
        date="2026-04-16"
        dayLabel="Thursday Apr 16"
        emptySlots={['dinner']}
        householdServings={4}
        {...props}
      />
    </Wrapper>,
  )
}

// The day's button opens a menu of routes per empty slot; each creates the
// placeholder, then opens the selector in its view (HON-1247, HON-1335).
async function chooseRoute(item: 'Choose a recipe' | 'Imagine a meal' = 'Choose a recipe') {
  const user = userEvent.setup()
  await user.click(addButton())
  const dinner = await screen.findByRole('group', { name: 'Dinner' })
  await user.click(within(dinner).getByRole('menuitem', { name: item }))
}

async function openSelector(item?: 'Choose a recipe' | 'Imagine a meal') {
  await chooseRoute(item)
  await screen.findByRole('dialog')
  await waitFor(() => expect(suggestionRequests()).toHaveLength(1))
}

function closeSelector() {
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
}

// The day's button is `aria-disabled`, not `disabled`, while a create or discard
// is pending (HON-803), so `toBeDisabled()` cannot see it.
function expectPending(button: HTMLElement) {
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).toBeEnabled()
}

function expectIdle(button: HTMLElement) {
  expect(button).not.toHaveAttribute('aria-disabled')
}

// jsdom has no `PageTransitionEvent`, so `persisted` is set on a plain event.
function pageHide({ persisted = false } = {}) {
  return Object.assign(new Event('pagehide'), { persisted })
}

const addButton = () => screen.getByRole('button', { name: ADD_NAME })
const createRequests = () =>
  requests.filter((r) => r.method === 'POST' && r.url === `/api/meal-plans/${PLAN_ID}/entries`)
const suggestionRequests = () => requests.filter((r) => r.url === `${ENTRY_URL}/suggestions`)
const deleteRequests = () => requests.filter((r) => r.method === 'DELETE')

describe('DayAddMenu', () => {
  // Every empty day has an "Add" button, so the name has to say which day,
  // and start with the visible text (WCAG 2.5.3) (HON-807, HON-1335).
  it('shows "Add" and names the day after it', () => {
    renderSlot()
    const button = addButton()
    expect(button).toHaveTextContent(/^Add$/)
    expect(button).toHaveAccessibleName(ADD_NAME)
  })

  // The routes to a meal, in today's order and words, then Extra; opening
  // the menu creates nothing yet.
  it('opens a menu of routes from a click', async () => {
    const user = userEvent.setup()
    renderSlot()

    await user.click(addButton())

    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Choose a recipe',
      'Pick for me',
      'Imagine a meal',
      'Fridge meal',
      'Extra',
    ])
    expect(addButton()).toHaveAttribute('aria-haspopup', 'menu')
    expect(addButton()).toHaveAttribute('aria-expanded', 'true')
    expect(createRequests()).toEqual([])
  })

  it('opens the menu from Enter', async () => {
    const user = userEvent.setup()
    renderSlot()

    addButton().focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('menuitem', { name: 'Choose a recipe' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Imagine a meal' })).toBeInTheDocument()
  })

  it('opens the library view from "Choose a recipe", with no Imagine button', async () => {
    renderSlot()
    await openSelector('Choose a recipe')

    expect(createRequests()).toHaveLength(1)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('searchbox', { name: 'Search meal library' })).toBeVisible()
    expect(within(dialog).getByRole('checkbox', { name: 'My recipes only' })).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: 'Imagine a meal' })).toBeNull()
  })

  it('opens the imagine view from "Imagine a meal", with no Back button', async () => {
    renderSlot()
    await chooseRoute('Imagine a meal')

    const dialog = await screen.findByRole('dialog')
    expect(createRequests()).toHaveLength(1)
    expect(
      within(dialog).getByRole('textbox', { name: "Describe the meal you're in the mood for" }),
    ).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: 'Back to library' })).toBeNull()
    expect(within(dialog).queryByRole('searchbox')).toBeNull()
    const title = within(dialog).getByRole('heading')
    expect(title).toHaveTextContent('Imagine a dinner for Thursday Apr 16')
    expect(title).toHaveTextContent('Dinner for Thu Apr 16')
  })

  it('discards the placeholder and returns focus when the imagine view closes', async () => {
    renderSlot()
    await chooseRoute('Imagine a meal')
    await screen.findByRole('dialog')

    closeSelector()
    await waitFor(() => expect(deleteRequests()).toHaveLength(1))
    expect(deleteRequests()[0]?.url).toBe(DISCARD_URL)
    await waitFor(() => expect(addButton()).toHaveFocus())

    deleteResponse.resolve(json({ success: true }))
    await waitFor(() => expectIdle(addButton()))
  })

  it('keeps the day in the name while the placeholder is being created', async () => {
    createResponse = deferred()
    renderSlot()

    await chooseRoute()
    const adding = await screen.findByRole('button', { name: 'Adding…: Thursday Apr 16' })
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
    expect(deleteRequests()[0]?.url).toBe(DISCARD_URL)

    deleteResponse.resolve(json({ success: true }))
    await waitFor(() => expectIdle(addButton()))

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

  it('marks the button pending while the placeholder is being discarded', async () => {
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(deleteRequests()).toHaveLength(1))
    expectPending(addButton())

    deleteResponse.resolve(json({ success: true }))
    await waitFor(() => expectIdle(addButton()))
  })

  it('ignores a second activation while the placeholder is being created', async () => {
    const user = userEvent.setup()
    createResponse = deferred()
    renderSlot()

    await chooseRoute()
    const adding = await screen.findByRole('button', { name: /^Adding…/ })
    expectPending(adding)

    // `pointer-events-none` is CSS, which jsdom does not apply, so a click here
    // reaches the trigger the way Enter and Space do in a browser.
    await user.click(adding)
    adding.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(createRequests()).toHaveLength(1)

    createResponse.resolve(json({ id: ENTRY_ID }))
    await screen.findByRole('dialog')
    expect(createRequests()).toHaveLength(1)
  })

  // One key that only opens: the activations above toggle, so they end shut
  // whether or not the guard holds.
  it('keeps the menu closed from ArrowDown while the placeholder is being created', async () => {
    const user = userEvent.setup()
    createResponse = deferred()
    renderSlot()

    await chooseRoute()
    const adding = await screen.findByRole('button', { name: /^Adding…/ })
    adding.focus()
    await user.keyboard('{ArrowDown}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(adding).toHaveAttribute('aria-expanded', 'false')

    createResponse.resolve(json({ id: ENTRY_ID }))
    await screen.findByRole('dialog')
  })

  it('ignores a second activation while the placeholder is being discarded', async () => {
    const user = userEvent.setup()
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(deleteRequests()).toHaveLength(1))
    const button = addButton()
    expectPending(button)

    await user.click(button)
    button.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(createRequests()).toHaveLength(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    deleteResponse.resolve(json({ success: true }))
    await waitFor(() => expectIdle(addButton()))
  })

  it('returns focus to the button when the selector closes without a pick', async () => {
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Still pending: the discard has not settled, and focus lands anyway.
    expectPending(addButton())
    await waitFor(() => expect(addButton()).toHaveFocus())
  })

  it('keeps the button focusable while it is pending', async () => {
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(deleteRequests()).toHaveLength(1))
    const button = addButton()
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

  // A tab that closes with the selector open never runs the close (HON-1251).
  it('discards the placeholder with a keepalive request when the page hides', async () => {
    renderSlot()
    await openSelector()

    window.dispatchEvent(pageHide())

    expect(deleteRequests()).toEqual([{ method: 'DELETE', url: DISCARD_URL, keepalive: true }])
  })

  // Back restores a page from the back/forward cache with the selector still
  // open on this entry, so it must still exist.
  it('keeps the placeholder when the page goes into the back/forward cache', async () => {
    renderSlot()
    await openSelector()

    window.dispatchEvent(pageHide({ persisted: true }))

    expect(deleteRequests()).toEqual([])
  })

  it('sends no keepalive discard once the selector has closed', async () => {
    renderSlot()
    await openSelector()
    closeSelector()
    await waitFor(() => expect(deleteRequests()).toHaveLength(1))

    window.dispatchEvent(pageHide())

    expect(deleteRequests()).toHaveLength(1)
  })

  it('ignores an error status from the discard', async () => {
    renderSlot()
    await openSelector()

    closeSelector()
    await waitFor(() => expect(deleteRequests()).toHaveLength(1))
    deleteResponse.resolve(json({ error: 'boom' }, 500))

    await waitFor(() => expectIdle(addButton()))
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

  // The slot's meal was just cleared and its card left with focus (HON-1123).
  describe('focusSlot', () => {
    it('takes focus from the page body once the slot is empty', () => {
      const onSlotFocused = vi.fn()
      renderSlot({ focusSlot: 'dinner', onSlotFocused })

      expect(addButton()).toHaveFocus()
      expect(onSlotFocused).toHaveBeenCalledTimes(1)
    })

    // Before the refresh lands, the cleared card is still on the page.
    it('waits while the cleared slot is not yet empty', () => {
      const onSlotFocused = vi.fn()
      renderSlot({ focusSlot: 'lunch', onSlotFocused })

      expect(addButton()).not.toHaveFocus()
      expect(onSlotFocused).not.toHaveBeenCalled()
    })

    it('leaves focus where the user moved it', () => {
      const elsewhere = document.createElement('button')
      document.body.append(elsewhere)
      elsewhere.focus()
      const onSlotFocused = vi.fn()

      renderSlot({ focusSlot: 'dinner', onSlotFocused })

      expect(elsewhere).toHaveFocus()
      expect(onSlotFocused).toHaveBeenCalledTimes(1)
      elsewhere.remove()
    })

    it('takes no focus without it', () => {
      renderSlot()

      expect(addButton()).not.toHaveFocus()
    })
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ExternalToast, toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { track } from '@/lib/analytics'
import { createQueryWrapper } from '@/test/query-wrapper'

import { DayAddMenu } from './DayAddMenu'

// "Pick for me" places the slot's top suggestion in one request, and a toast
// offers Undo, as Clear does (HON-1248).

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const ENTRIES_URL = '/api/meal-plans/plan-1/entries'
const SLOT_NAME = 'Add to Thursday Apr 16'
const picked = {
  id: 'entry-9',
  date: '2026-04-16',
  mealType: 'dinner',
  status: 'planned',
  mealId: 'meal-7',
  note: null,
  mealName: 'Fish pie',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let requests: { method: string; url: string; body: unknown }[]
let pickResponse: () => Promise<Response>
let deleteStatus: number

beforeEach(() => {
  requests = []
  pickResponse = () => Promise.resolve(json(picked))
  deleteStatus = 200
  refresh.mockClear()
  vi.mocked(toast).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(track).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (method === 'POST' && url === ENTRIES_URL) return pickResponse()
      if (method === 'DELETE' && url === `${ENTRIES_URL}/entry-9`) {
        return Promise.resolve(json({ success: true }, deleteStatus))
      }
      return Promise.reject(new Error(`unexpected ${method} ${url}`))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderSlot(onPicked = vi.fn()) {
  const { wrapper: Wrapper, queryClient } = createQueryWrapper()
  render(
    <Wrapper>
      <DayAddMenu
        planId="plan-1"
        date="2026-04-16"
        dayLabel="Thursday Apr 16"
        emptySlots={['dinner']}
        householdServings={4}
        onPicked={onPicked}
      />
    </Wrapper>,
  )
  return { onPicked, queryClient }
}

async function pickForMe() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: SLOT_NAME }))
  await user.click(await screen.findByRole('menuitem', { name: 'Pick for me' }))
  return user
}

function clickUndo(options?: ExternalToast) {
  const action = options?.action
  if (!action || typeof action !== 'object' || !('onClick' in action)) {
    throw new Error('The toast has no Undo action')
  }
  action.onClick({} as React.MouseEvent<HTMLButtonElement>)
}

async function pickedToast() {
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
  return vi.mocked(toast).mock.calls[0]!
}

describe('DayAddMenu: Pick for me', () => {
  it('sends one POST that asks for the top suggestion', async () => {
    renderSlot()

    await pickForMe()
    await pickedToast()

    expect(requests).toEqual([
      {
        method: 'POST',
        url: ENTRIES_URL,
        body: { date: '2026-04-16', mealType: 'dinner', pick: 'suggested' },
      },
    ])
  })

  it('reads "Adding…" and stays aria-disabled with the menu shut while the pick runs', async () => {
    pickResponse = () => new Promise(() => {})
    renderSlot()

    const user = await pickForMe()
    const adding = await screen.findByRole('button', { name: 'Adding…: Thursday Apr 16' })
    expect(adding).toHaveAttribute('aria-disabled', 'true')

    adding.focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(requests).toHaveLength(1)
  })

  it('refreshes, tells the page, tracks once and offers Undo for six seconds', async () => {
    const { onPicked } = renderSlot()

    await pickForMe()
    const [message, options] = await pickedToast()

    expect(message).toBe('Picked for you: Fish pie')
    expect(options).toMatchObject({ action: { label: 'Undo' }, duration: 6000 })
    expect(onPicked).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('meal_plan:slot_filled', {
      plan_id: 'plan-1',
      meal_id: 'meal-7',
      via: 'pick_for_me',
    })
  })

  it("deletes the entry and refreshes on Undo, keeping other cards' suggestions", async () => {
    const { queryClient } = renderSlot()
    // Another card's cached list, as `MealSelectorModal` keys it.
    const otherCard = ['meal-suggestions', 'plan-1', 'entry-3', 'swap']

    await pickForMe()
    const [, options] = await pickedToast()
    // The test client collects unobserved queries at once; keep this one so
    // the test can see that Undo leaves it. A placed meal no longer changes
    // another slot's suggestions (HON-1393).
    queryClient.setQueryDefaults(otherCard, { gcTime: Infinity })
    queryClient.setQueryData(otherCard, [{ id: 'meal-7' }])
    refresh.mockClear()
    clickUndo(options)

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(queryClient.getQueryData(otherCard)).toEqual([{ id: 'meal-7' }])
    expect(requests.at(-1)).toEqual({
      method: 'DELETE',
      url: `${ENTRIES_URL}/entry-9`,
      body: null,
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('says so when Undo fails', async () => {
    deleteStatus = 500
    renderSlot()

    await pickForMe()
    const [, options] = await pickedToast()
    clickUndo(options)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't restore the meal. Add it again from the empty slot.",
      ),
    )
  })

  it.each([
    [
      'no meal fits',
      () => json({ error: 'No meals available', code: 'no_suggestions' }, 404),
      'No meal fits this slot yet. Choose a recipe instead.',
    ],
    [
      'the rate limit, with its reset time',
      () =>
        json(
          { error: 'Rate limit exceeded', resetAt: new Date(2026, 3, 16, 18, 40).toISOString() },
          429,
        ),
      'Too many suggestion requests in the last hour. Try again after 6:40 PM, or search for a meal.',
    ],
    [
      'the AI cap',
      () => json({ error: 'AI usage cap exceeded', code: 'ai_cap_exceeded' }, 429),
      "This month's AI usage limit is used up. It resets at the start of next month.",
    ],
    ['a taken slot', () => json({ error: 'Entry already exists' }, 409), 'Failed to add meal slot'],
    [
      'a server failure',
      () => json({ error: 'Failed to create entry' }, 500),
      'Failed to add meal slot',
    ],
  ])('shows catalog copy for %s, not the server text', async (_label, response, copy) => {
    pickResponse = () => Promise.resolve(response())
    const { onPicked } = renderSlot()

    await pickForMe()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(copy))
    expect(toast).not.toHaveBeenCalled()
    expect(onPicked).not.toHaveBeenCalled()
    expect(track).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: SLOT_NAME })).not.toHaveAttribute('aria-disabled')
  })
})

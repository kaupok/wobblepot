import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ExternalToast, toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { track } from '@/lib/analytics'
import { createQueryWrapper } from '@/test/query-wrapper'

import { MealCard } from './MealCard'

// The cleared card kept its note, so its entry exists: "Pick for me" asks the
// suggestions route, assigns the first, and Undo puts the note back where it
// lay (HON-1248).

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const ENTRIES_URL = '/api/meal-plans/plan-1/entries'
const ENTRY_URL = `${ENTRIES_URL}/entry-1`

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let requests: { method: string; url: string; body: unknown }[]
let suggestionsAnswer: () => Response

beforeEach(() => {
  requests = []
  suggestionsAnswer = () =>
    json({
      alternatives: [
        { id: 'meal-7', name: 'Fish pie' },
        { id: 'meal-8', name: 'Lentil soup' },
      ],
    })
  refresh.mockClear()
  vi.mocked(toast).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(track).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (method === 'POST' && url === `${ENTRY_URL}/suggestions`) {
        return Promise.resolve(suggestionsAnswer())
      }
      if (method === 'POST' && url === ENTRIES_URL) return Promise.resolve(json({ id: 'entry-2' }))
      return Promise.resolve(json({ success: true }))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderClearedCard(onPicked = vi.fn()) {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <MealCard
        entryId="entry-1"
        planId="plan-1"
        date="2026-10-10"
        mealType="dinner"
        status="planned"
        householdServings={4}
        meal={null}
        note="Leftovers from Sunday"
        noteX={0.25}
        noteY={0.75}
        onPicked={onPicked}
      />
    </Wrapper>,
  )
  return { onPicked }
}

async function pickForMe() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Add meal' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Pick for me' }))
}

async function pickedToast() {
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
  return vi.mocked(toast).mock.calls[0]!
}

function clickUndo(options?: ExternalToast) {
  const action = options?.action
  if (!action || typeof action !== 'object' || !('onClick' in action)) {
    throw new Error('The toast has no Undo action')
  }
  action.onClick({} as React.MouseEvent<HTMLButtonElement>)
}

describe('MealCard cleared card: Pick for me', () => {
  it('assigns the first suggestion to the existing entry', async () => {
    const { onPicked } = renderClearedCard()

    await pickForMe()
    const [message] = await pickedToast()

    expect(requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      { method: 'POST', url: `${ENTRY_URL}/suggestions`, body: null },
      { method: 'PATCH', url: ENTRY_URL, body: { mealId: 'meal-7' } },
    ])
    expect(message).toBe('Picked for you: Fish pie')
    expect(onPicked).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('meal_plan:slot_filled', {
      plan_id: 'plan-1',
      meal_id: 'meal-7',
      via: 'pick_for_me',
    })
  })

  it('puts the note back where it lay on Undo', async () => {
    renderClearedCard()

    await pickForMe()
    const [, options] = await pickedToast()
    refresh.mockClear()
    clickUndo(options)

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests.slice(2)).toEqual([
      { method: 'DELETE', url: ENTRY_URL, body: null },
      {
        method: 'POST',
        url: ENTRIES_URL,
        body: {
          date: '2026-10-10',
          mealType: 'dinner',
          note: 'Leftovers from Sunday',
          noteX: 0.25,
          noteY: 0.75,
        },
      },
    ])
  })

  it('shows the no-match copy and assigns nothing when no meal fits', async () => {
    suggestionsAnswer = () => json({ error: 'No meals available', code: 'no_suggestions' }, 404)
    const { onPicked } = renderClearedCard()

    await pickForMe()

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'No meal fits this slot yet. Choose a recipe instead.',
      ),
    )
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false)
    expect(onPicked).not.toHaveBeenCalled()
  })

  it('reads "Adding…" and keeps the menu shut while the pick runs', async () => {
    suggestionsAnswer = () => {
      throw new Error('unused')
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    renderClearedCard()

    await pickForMe()

    const adding = await screen.findByRole('button', { name: 'Adding…' })
    expect(adding).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

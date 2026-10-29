import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryWrapper } from '@/test/query-wrapper'

import { CookForLunchDialog } from './CookForLunchDialog'

// "Cook for tomorrow's lunch too" (HON-1396), with the real mutation against a
// stubbed fetch.

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

let requests: { url: string; body: unknown }[]
let answer: { status: number; body: unknown }

beforeEach(() => {
  requests = []
  answer = { status: 200, body: { outcome: 'planned', date: '2026-10-22' } }
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.success).mockClear()
  refresh.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(
        new Response(JSON.stringify(answer.body), {
          status: answer.status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderDialog() {
  const onOpenChange = vi.fn()
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <CookForLunchDialog
        open
        onOpenChange={onOpenChange}
        planId="plan-1"
        entryId="entry-curry"
        mealName="Chicken curry"
        householdServings={2}
      />
    </Wrapper>,
  )
  const dialog = within(screen.getByRole('dialog', { name: "Cook for tomorrow's lunch too" }))
  const servings = within(dialog.getByRole('group', { name: 'Servings for lunch' }))
  return { dialog, servings, onOpenChange, user: userEvent.setup() }
}

describe('CookForLunchDialog', () => {
  it("starts at the household's servings and sends the servings set", async () => {
    const { dialog, servings, onOpenChange, user } = renderDialog()

    expect(servings.getByText('2 servings')).toBeInTheDocument()
    await user.click(servings.getByRole('button', { name: 'More servings' }))
    await user.click(dialog.getByRole('button', { name: 'Add to lunch' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(requests).toEqual([
      {
        url: '/api/meal-plans/plan-1/entries/entry-curry/leftover-lunch',
        body: { servings: 2.5 },
      },
    ])
    expect(toast.success).toHaveBeenCalledWith("Tomorrow's lunch takes leftovers: Chicken curry.")
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('words a refusal from the catalog by its code, and stays open', async () => {
    answer = {
      status: 409,
      body: { error: 'Leftover lunch refused: alreadyLinked', code: 'alreadyLinked' },
    }
    const { dialog, onOpenChange, user } = renderDialog()

    await user.click(dialog.getByRole('button', { name: 'Add to lunch' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Tomorrow's lunch already takes leftovers from this meal. Change the servings in the lunch's Edit items.",
      ),
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('falls back to the generic failure for an unknown answer', async () => {
    answer = { status: 500, body: { error: 'boom' } }
    const { dialog, user } = renderDialog()

    await user.click(dialog.getByRole('button', { name: 'Add to lunch' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't add the lunch. Please try again."),
    )
  })
})

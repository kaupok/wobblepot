import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import type { MealType } from '@/generated/prisma/enums'
import { DayAddMenu } from './DayAddMenu'

// One "+ Add" menu per day: a group per empty slot, then Extra (HON-1335).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

const ROUTES = ['Choose a recipe', 'Pick for me', 'Imagine a meal', 'Fridge meal']

let requests: { method: string; url: string }[]

beforeEach(() => {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      requests.push({ method: init?.method ?? 'GET', url })
      return Promise.resolve(
        new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderMenu(emptySlots: MealType[]) {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <DayAddMenu
        planId="plan-1"
        date="2026-04-16"
        dayLabel="Thursday Apr 16"
        emptySlots={emptySlots}
        householdServings={4}
      />
    </Wrapper>,
  )
  return userEvent.setup()
}

const addButton = () => screen.getByRole('button', { name: 'Add to Thursday Apr 16' })

describe('DayAddMenu groups', () => {
  it('shows one group per empty slot, in slot order, each with the routes', async () => {
    const user = renderMenu(['breakfast', 'lunch', 'dinner'])

    await user.click(addButton())

    const menu = await screen.findByRole('menu')
    const groups = within(menu).getAllByRole('group')
    expect(groups.map((group) => group.firstElementChild?.textContent)).toEqual([
      'Breakfast',
      'Lunch',
      'Dinner',
    ])
    for (const name of ['Breakfast', 'Lunch', 'Dinner']) {
      const group = within(menu).getByRole('group', { name })
      expect(
        within(group)
          .getAllByRole('menuitem')
          .map((item) => item.textContent),
      ).toEqual(ROUTES)
    }
  })

  it('leaves out a filled slot', async () => {
    const user = renderMenu(['lunch'])

    await user.click(addButton())

    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('group')).toHaveLength(1)
    expect(within(menu).queryByRole('group', { name: 'Dinner' })).toBeNull()
    expect(within(menu).queryByRole('group', { name: 'Breakfast' })).toBeNull()
  })

  it('labels the group also when only one slot is empty', async () => {
    const user = renderMenu(['dinner'])

    await user.click(addButton())

    const group = await screen.findByRole('group', { name: 'Dinner' })
    expect(within(group).getByText('Dinner')).toBeVisible()
  })

  it('ends with Extra after a separator', async () => {
    const user = renderMenu(['lunch', 'dinner'])

    await user.click(addButton())

    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    const extra = items.at(-1)
    expect(extra).toHaveTextContent(/^Extra$/)
    const lastChild = menu.lastElementChild
    expect(lastChild).toBe(extra)
    expect(lastChild?.previousElementSibling).toHaveAttribute('role', 'separator')
  })

  it('opens the add-extra dialog from Extra and returns focus to Add on close', async () => {
    const user = renderMenu(['dinner'])

    await user.click(addButton())
    await user.click(await screen.findByRole('menuitem', { name: 'Extra' }))

    const dialog = await screen.findByRole('dialog', { name: 'Add an extra' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(addButton()).toHaveFocus())
    // An extra is not a meal: no placeholder entry for the slot.
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([])
  })

  it('shows the "+ Extra" button alone when no slot is empty', async () => {
    const user = renderMenu([])

    const extra = screen.getByRole('button', { name: 'Add an extra: Thursday Apr 16' })
    expect(extra).toHaveTextContent(/^Extra$/)
    expect(extra).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.queryByRole('button', { name: /^Add to / })).toBeNull()

    await user.click(extra)
    expect(await screen.findByRole('dialog', { name: 'Add an extra' })).toBeInTheDocument()
  })
})

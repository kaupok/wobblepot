import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MealType } from '@/generated/prisma/enums'
import { createQueryWrapper } from '@/test/query-wrapper'

import { DayAddMenu } from './DayAddMenu'

// One "+ Add" menu per day: the routes for each empty slot, then Extra
// (HON-1335). Two or more empty slots each open a submenu (HON-1341). The
// meal types the day does not expect follow after a separator (HON-1518).

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

function renderMenu(emptySlots: MealType[], otherSlots?: MealType[]) {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <DayAddMenu
        planId="plan-1"
        date="2026-04-16"
        dayLabel="Thursday Apr 16"
        emptySlots={emptySlots}
        otherSlots={otherSlots}
        householdServings={4}
      />
    </Wrapper>,
  )
  return userEvent.setup()
}

const addButton = () => screen.getByRole('button', { name: 'Add to Thursday Apr 16' })

describe('DayAddMenu groups', () => {
  it('shows one submenu per empty slot, in slot order, then Extra', async () => {
    const user = renderMenu(['breakfast', 'lunch', 'dinner'])

    await user.click(addButton())

    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Extra'])
    for (const slot of items.slice(0, 3)) {
      expect(slot).toHaveAttribute('aria-haspopup', 'menu')
    }
    expect(within(menu).queryByRole('group')).toBeNull()
  })

  it('opens a slot submenu with the routes on a tap', async () => {
    const user = renderMenu(['lunch', 'dinner'])

    await user.click(addButton())
    await user.click(await screen.findByRole('menuitem', { name: 'Dinner' }))

    const submenu = await screen.findByRole('menu', { name: 'Dinner' })
    expect(
      within(submenu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(ROUTES)
  })

  it('opens a slot submenu with ArrowRight and closes it with ArrowLeft', async () => {
    const user = renderMenu(['lunch', 'dinner'])

    addButton().focus()
    await user.keyboard('{Enter}')
    const lunch = await screen.findByRole('menuitem', { name: 'Lunch' })
    await waitFor(() => expect(lunch).toHaveFocus())
    await user.keyboard('{ArrowRight}')

    await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(2))
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Choose a recipe' })).toHaveFocus(),
    )

    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(1))
    expect(lunch).toHaveFocus()
  })

  it('runs a route from a submenu for the slot it belongs to', async () => {
    const user = renderMenu(['lunch', 'dinner'])

    // By keyboard: jsdom does not finish a pointer click inside a Radix
    // submenu. The `MenuOpen` story clicks through one in a browser.
    addButton().focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Lunch' })).toHaveFocus())
    await user.keyboard('{ArrowDown}{ArrowRight}')
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Choose a recipe' })).toHaveFocus(),
    )
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    await waitFor(() =>
      expect(requests).toContainEqual({ method: 'POST', url: '/api/meal-plans/plan-1/entries' }),
    )
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ date: '2026-04-16', mealType: 'dinner' })
  })

  it('leaves out a filled slot', async () => {
    const user = renderMenu(['breakfast', 'dinner'])

    await user.click(addButton())

    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Lunch' })).toBeNull()
  })

  it('shows the only empty slot flat, its routes under its label', async () => {
    const user = renderMenu(['dinner'])

    await user.click(addButton())

    const menu = await screen.findByRole('menu')
    const group = within(menu).getByRole('group', { name: 'Dinner' })
    expect(within(group).getByText('Dinner')).toBeVisible()
    expect(
      within(group)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(ROUTES)
    expect(within(menu).queryByRole('menuitem', { name: 'Dinner' })).toBeNull()
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

  it("keeps a dinner-only day's routes flat, then the other types after a separator", async () => {
    const user = renderMenu(['dinner'], ['breakfast', 'lunch'])

    await user.click(addButton())

    const menu = await screen.findByRole('menu')
    const shape = [...menu.children].map((child) =>
      child.getAttribute('role') === 'separator' ? '---' : child.textContent,
    )
    expect(shape).toEqual(['Dinner' + ROUTES.join(''), '---', 'Breakfast', 'Lunch', '---', 'Extra'])
    expect(within(menu).getByRole('group', { name: 'Dinner' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Breakfast' })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    )
  })

  it('starts with the other types, no separator first, when every expected slot is planned', async () => {
    const user = renderMenu([], ['breakfast', 'lunch'])

    await user.click(addButton())

    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Breakfast', 'Lunch', 'Extra'])
    expect(menu.firstElementChild).toBe(items[0])
  })

  it('runs a route under another type for that type', async () => {
    const user = renderMenu(['dinner'], ['breakfast', 'lunch'])

    addButton().focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Choose a recipe' })).toHaveFocus(),
    )
    // Past Dinner's four routes and the separator to Breakfast.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Breakfast' })).toHaveFocus())
    await user.keyboard('{ArrowRight}')
    const submenu = await screen.findByRole('menu', { name: 'Breakfast' })
    await waitFor(() =>
      expect(within(submenu).getByRole('menuitem', { name: 'Choose a recipe' })).toHaveFocus(),
    )
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    await waitFor(() =>
      expect(requests).toContainEqual({ method: 'POST', url: '/api/meal-plans/plan-1/entries' }),
    )
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      date: '2026-04-16',
      mealType: 'breakfast',
    })
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

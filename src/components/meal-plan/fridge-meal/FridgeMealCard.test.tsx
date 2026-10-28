import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { createQueryWrapper } from '@/test/query-wrapper'
import { fridgeItems, fridgePantryItems } from '@/stories/fridge-fixtures'
import { FridgeMealCard } from './FridgeMealCard'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const ENTRY_URL = '/api/meal-plans/plan-1/entries/entry-1'
let requests: { method: string; url: string; body: unknown }[]

beforeEach(() => {
  requests = []
  refresh.mockClear()
  vi.mocked(toast).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      const body =
        method === 'PATCH' ? { id: 'entry-1', pantryDeducted: true } : { success: true, meals: [] }
      return Promise.resolve(
        new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderCard(
  props: {
    status?: 'planned' | 'completed'
    items?: typeof fridgeItems
    pantryDeducted?: boolean
  } = {},
) {
  const onCleared = vi.fn()
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <FridgeMealCard
        entryId="entry-1"
        planId="plan-1"
        date="2026-10-21"
        mealType="dinner"
        status={props.status ?? 'planned'}
        items={props.items ?? fridgeItems}
        note="Heat the mash first"
        pantryItems={fridgePantryItems}
        pantryDeducted={props.pantryDeducted}
        onCleared={onCleared}
      />
    </Wrapper>,
  )
  return { onCleared, user: userEvent.setup() }
}

const patches = () => requests.filter((r) => r.method === 'PATCH')
const trigger = () => screen.getByRole('button', { name: /^More actions: Fridge meal: / })

async function choose(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(trigger())
  await user.click(await screen.findByRole('menuitem', { name }))
}

async function menuItems(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger())
  const menu = within(await screen.findByRole('menu'))
  return menu.getAllByRole('menuitem').map((item) => item.textContent)
}

describe('FridgeMealCard', () => {
  it('names the meal by its leftovers, with the other items under them, and shows no rating, tips or cook-question controls', () => {
    renderCard({ status: 'completed' })

    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(/^Mash$/)
    expect(
      screen.getByText('+ Cauliflower and broccoli mix, Cucumber, store meatballs'),
    ).toBeInTheDocument()
    expect(screen.getByText('Leftovers')).toBeInTheDocument()
    expect(screen.queryByText('From the fridge')).not.toBeInTheDocument()
    expect(screen.getByText('Eaten')).toBeInTheDocument()
    expect(screen.queryByText('How was it?')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /thumbs|rate/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /tips|cook|steps|ask/i })).not.toBeInTheDocument()
  })

  it('completes with the ticked pantry item through the dialog', async () => {
    const { user } = renderCard()

    await choose(user, 'Eaten')
    const dialog = within(await screen.findByRole('dialog', { name: 'Did you use anything up?' }))
    await user.click(dialog.getByRole('checkbox', { name: 'Used it all: Cucumber' }))
    await user.click(dialog.getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(patches()).toEqual([
      {
        method: 'PATCH',
        url: ENTRY_URL,
        body: { status: 'completed', deductPantry: false, usedUpIngredientIds: ['cucumber'] },
      },
    ])
    // The menu's item left with the menu, so focus goes back to its trigger.
    expect(trigger()).toHaveFocus()
  })

  // Today's and tomorrow's dinner can both be fridge meals (HON-1287).
  it("names each card's ⋯ menu by its items, so two cards differ", () => {
    const { wrapper: Wrapper } = createQueryWrapper()
    const card = (entryId: string, items: typeof fridgeItems) => (
      <FridgeMealCard
        entryId={entryId}
        planId="plan-1"
        date="2026-10-21"
        mealType="dinner"
        status="planned"
        items={items}
        pantryItems={fridgePantryItems}
      />
    )
    render(
      <Wrapper>
        {card('entry-1', fridgeItems.slice(2))}
        {card('entry-2', fridgeItems.slice(0, 1))}
      </Wrapper>,
    )

    expect(
      screen
        .getAllByRole('button', { name: /^More actions/ })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'More actions: Fridge meal: Cucumber, store meatballs',
      'More actions: Fridge meal: Mash, from Tuesday',
    ])
    // The items are the name, with the first letter in capitals; leftovers
    // name the card by their meal alone.
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Cucumber, store meatballs',
      'Mash',
    ])
    expect(screen.getAllByText(/^(From the fridge|Leftovers)$/).map((b) => b.textContent)).toEqual([
      'From the fridge',
      'Leftovers',
    ])
  })

  it('names the button over the name by the leftovers and the items under them', () => {
    renderCard()

    expect(
      screen.getByRole('button', {
        name: 'Mash + Cauliflower and broccoli mix, Cucumber, store meatballs',
      }),
    ).toBeInTheDocument()
  })

  it('capitalises free text that starts the name', () => {
    renderCard({ items: fridgeItems.slice(3) })

    expect(screen.getByRole('heading', { name: 'Store meatballs' })).toBeInTheDocument()
  })

  it('says a planned fridge meal needs nothing bought', () => {
    renderCard()

    expect(screen.getByText('Nothing to buy')).toBeInTheDocument()
  })

  // The fixed fridge tint, so the card is not the plain card an empty slot looks like.
  it('takes the fridge tint when no item is leftovers with a picture', () => {
    renderCard()

    expect(document.querySelector('[data-meal-surface]')).toHaveAttribute(
      'data-meal-surface',
      'fridge',
    )
  })

  it("takes the leftovers' meal's picture when it has one", () => {
    const withImage = fridgeItems.map((item) =>
      item.sourceEntryId
        ? {
            ...item,
            image: {
              imageUrl: 'https://example.com/mash.png',
              imageStatus: 'ready' as const,
              imageHue: 40,
            },
          }
        : item,
    )
    renderCard({ items: withImage })

    expect(document.querySelector('[data-meal-surface]')).toHaveAttribute('data-meal-surface', '')
    expect(screen.getByRole('img')).toHaveAttribute('alt', expect.stringMatching(/^Mash/))
  })

  it('opens the items from a click on the card', async () => {
    const { user } = renderCard()

    await user.click(screen.getByText('Nothing to buy'))

    expect(await screen.findByRole('dialog', { name: 'Fridge meal' })).toBeInTheDocument()
  })

  it('completes with no dialog when no item is from the pantry', async () => {
    const { user } = renderCard({ items: fridgeItems.filter((i) => i.ingredientId === null) })

    await choose(user, 'Eaten')

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0]!.body).toEqual({ status: 'completed', deductPantry: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('completes with no dialog when the pantry was marked once already', async () => {
    const { user } = renderCard({ pantryDeducted: true })

    await choose(user, 'Eaten')

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers Note, Eaten, Edit items and Clear on a planned fridge meal', async () => {
    const { user } = renderCard()

    expect(await menuItems(user)).toEqual(['Note', 'Eaten', 'Edit items', 'Clear'])
  })

  it('reverts a completed fridge meal and offers no edit or clear on it', async () => {
    const { user } = renderCard({ status: 'completed' })

    expect(await menuItems(user)).toEqual(['Not eaten yet'])
    await user.click(screen.getByRole('menuitem', { name: 'Not eaten yet' }))

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0]!.body).toEqual({ status: 'planned', deductPantry: false })
  })

  it('opens the picker on its items from "Edit items"', async () => {
    const { user } = renderCard()

    await choose(user, 'Edit items')

    const dialog = within(await screen.findByRole('dialog', { name: 'Fridge meal' }))
    expect(dialog.getByRole('button', { name: 'Remove: Cucumber' })).toBeInTheDocument()
  })

  it('clears the entry, and Undo posts the items and the note back', async () => {
    const { onCleared, user } = renderCard()

    await choose(user, 'Clear')

    await waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1))
    expect(requests).toContainEqual({ method: 'DELETE', url: ENTRY_URL, body: null })
    const [message, options] = vi.mocked(toast).mock.calls[0]!
    expect(message).toBe(
      'Cleared: Fridge meal: Mash, from Tuesday, Cauliflower and broccoli mix, Cucumber, store meatballs',
    )
    const action = options?.action as { onClick: (e: unknown) => void }
    action.onClick({})

    await waitFor(() => expect(requests.some((r) => r.method === 'POST')).toBe(true))
    expect(requests.find((r) => r.method === 'POST')).toEqual({
      method: 'POST',
      url: '/api/meal-plans/plan-1/entries',
      body: {
        date: '2026-10-21',
        mealType: 'dinner',
        fridgeItems: [
          { sourceEntryId: 'entry-mash' },
          { ingredientId: 'veg-mix' },
          { ingredientId: 'cucumber' },
          { label: 'store meatballs' },
        ],
        note: 'Heat the mash first',
        noteX: null,
        noteY: null,
      },
    })
  })
})

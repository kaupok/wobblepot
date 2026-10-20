import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { createQueryWrapper } from '@/test/query-wrapper'
import { fridgeItems, fridgePantryItems, fridgeRecentMeals } from '@/stories/fridge-fixtures'
import { FridgeMealPicker } from './FridgeMealPicker'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

let requests: { method: string; url: string; body: unknown }[]
let saveStatus: number

beforeEach(() => {
  requests = []
  saveStatus = 200
  vi.mocked(toast.error).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      const [status, body] =
        url === '/api/entries/recent'
          ? [200, { meals: fridgeRecentMeals }]
          : [saveStatus, saveStatus === 200 ? { id: 'entry-new' } : { error: 'Refused' }]
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderPicker(props: { entryId?: string; initialItems?: typeof fridgeItems } = {}) {
  const onSaved = vi.fn()
  const onOpenChange = vi.fn()
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <FridgeMealPicker
        open
        onOpenChange={onOpenChange}
        planId="plan-1"
        date="2026-10-21"
        mealType="dinner"
        pantryItems={fridgePantryItems}
        onSaved={onSaved}
        {...props}
      />
    </Wrapper>,
  )
  const dialog = within(screen.getByRole('dialog', { name: 'Fridge meal' }))
  return { dialog, onSaved, onOpenChange, user: userEvent.setup() }
}

const chosen = (dialog: ReturnType<typeof within>) =>
  within(dialog.getByRole('region', { name: 'In this meal' }))
    .queryAllByRole('listitem')
    .map((li) => li.textContent)

const saves = () => requests.filter((r) => r.method !== 'GET')

describe('FridgeMealPicker', () => {
  it('opens with nothing chosen and offers the pantry, recent meals and free text', async () => {
    const { dialog } = renderPicker()

    expect(dialog.getByText('Nothing added yet.')).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Add: Butter' })).toBeInTheDocument()
    expect(
      await dialog.findByRole('button', { name: 'Add: Mash, from Tuesday' }),
    ).toBeInTheDocument()
    expect(dialog.getByLabelText('Something else')).toBeInTheDocument()
  })

  it('filters the pantry by the search, and drops an added item from the matches', async () => {
    const { dialog, user } = renderPicker()

    await user.type(dialog.getByLabelText('Search the pantry'), 'cuc')

    const add = dialog.getByRole('button', { name: 'Add: Cucumber' })
    expect(dialog.queryByRole('button', { name: 'Add: Paprika' })).not.toBeInTheDocument()
    await user.click(add)

    expect(chosen(dialog)).toEqual(['Cucumber'])
    expect(dialog.queryByRole('button', { name: 'Add: Cucumber' })).not.toBeInTheDocument()
  })

  it('says so when nothing in the pantry matches', async () => {
    const { dialog, user } = renderPicker()

    await user.type(dialog.getByLabelText('Search the pantry'), 'tofu')

    expect(dialog.getByText('Nothing in the pantry matches "tofu".')).toBeInTheDocument()
  })

  it('creates the fridge meal in the slot with the items in the order added', async () => {
    const { dialog, onSaved, onOpenChange, user } = renderPicker()

    await user.click(await dialog.findByRole('button', { name: 'Add: Mash, from Tuesday' }))
    await user.click(dialog.getByRole('button', { name: 'Add: Cucumber' }))
    await user.type(dialog.getByLabelText('Something else'), 'store meatballs{Enter}')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(saves()).toEqual([
      {
        method: 'POST',
        url: '/api/meal-plans/plan-1/entries',
        body: {
          date: '2026-10-21',
          mealType: 'dinner',
          fridgeItems: [
            { sourceEntryId: 'entry-mash' },
            { ingredientId: 'cucumber' },
            { label: 'store meatballs' },
          ],
        },
      },
    ])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('asks for an item instead of saving an empty meal', async () => {
    const { dialog, user } = renderPicker()

    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(dialog.getByText('Add at least one item, then save.')).toBeInTheDocument()
    expect(saves()).toEqual([])
  })

  it("edits an entry's items: starts from them, removes one, and PATCHes the rest", async () => {
    const { dialog, onSaved, user } = renderPicker({
      entryId: 'entry-1',
      initialItems: fridgeItems,
    })

    expect(chosen(dialog)).toEqual([
      'Mash, from Tuesday',
      'Cauliflower and broccoli mix',
      'Cucumber',
      'store meatballs',
    ])
    await user.click(dialog.getByRole('button', { name: 'Remove: Cucumber' }))
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(saves()).toEqual([
      {
        method: 'PATCH',
        url: '/api/meal-plans/plan-1/entries/entry-1',
        body: {
          fridgeItems: [
            { sourceEntryId: 'entry-mash' },
            { ingredientId: 'veg-mix' },
            { label: 'store meatballs' },
          ],
        },
      },
    ])
  })

  it('does not offer a recent meal that is already an item', async () => {
    const { dialog } = renderPicker({ entryId: 'entry-1', initialItems: fridgeItems })

    expect(
      await dialog.findByRole('button', { name: 'Add: Lentil soup, from Monday' }),
    ).toBeInTheDocument()
    expect(
      dialog.queryByRole('button', { name: 'Add: Mash, from Tuesday' }),
    ).not.toBeInTheDocument()
  })

  it('shows catalog copy, not the server error, when the meal was eaten meanwhile', async () => {
    saveStatus = 409
    const { dialog, onSaved, user } = renderPicker({
      entryId: 'entry-1',
      initialItems: fridgeItems,
    })

    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This meal is already eaten, so its items cannot change. Refresh the page to see it.',
      ),
    )
    expect(onSaved).not.toHaveBeenCalled()
  })
})

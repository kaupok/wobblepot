import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { createQueryWrapper } from '@/test/query-wrapper'
import {
  fridgeItems,
  fridgePantryItems,
  fridgePlannedSource,
  fridgeRecentMeals,
  plannedLeftoverItem,
} from '@/stories/fridge-fixtures'
import { createPantryItem } from '@/stories/fixtures'
import { FridgeMealPicker } from './FridgeMealPicker'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

let requests: { method: string; url: string; body: unknown }[]
let saveStatus: number
let saveBody: unknown
// What `/api/entries/recent` lists for the slot; a test sets a planned source.
let leftoverSources: typeof fridgeRecentMeals

beforeEach(() => {
  requests = []
  saveStatus = 200
  saveBody = undefined
  leftoverSources = fridgeRecentMeals
  vi.mocked(toast.error).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      const [status, body] = url.startsWith('/api/entries/recent')
        ? [200, { meals: leftoverSources, defaultServings: 2 }]
        : [
            saveStatus,
            saveBody ?? (saveStatus === 200 ? { id: 'entry-new' } : { error: 'Refused' }),
          ]
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

function renderPicker(
  props: {
    entryId?: string
    initialItems?: typeof fridgeItems
    pantryItems?: typeof fridgePantryItems
    date?: string
    mealType?: 'breakfast' | 'lunch' | 'dinner'
  } = {},
) {
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

// An item's words, then its marker, if any: "Cucumber pantry". A leftover's
// servings control is read apart, through `servingsOf`.
const chosen = (dialog: ReturnType<typeof within>) =>
  within(dialog.getByRole('region', { name: 'In this meal' }))
    .queryAllByRole('listitem')
    .map((li) =>
      within(li)
        .getAllByRole('paragraph')
        .filter((p) => !p.closest('[role="group"]'))
        .map((p) => p.textContent)
        .join(' '),
    )

const servingsOf = (dialog: ReturnType<typeof within>, name: string) =>
  within(dialog.getByRole('group', { name: `Servings: ${name}` }))

const freeTextItem = (label: string): (typeof fridgeItems)[number] => ({
  id: `item-${label}`,
  ingredientId: null,
  sourceEntryId: null,
  label,
  name: null,
  sourceDate: null,
  servings: null,
})

const saves = () => requests.filter((r) => r.method !== 'GET')

describe('FridgeMealPicker', () => {
  it('opens with nothing chosen and offers the leftovers, then the pantry', async () => {
    const { dialog } = renderPicker()

    expect(dialog.getByText('Nothing added yet.')).toBeInTheDocument()
    expect(dialog.getByLabelText('What are you having?')).toBeInTheDocument()
    expect(
      await dialog.findByRole('button', { name: 'Add: Mash, from Tuesday' }),
    ).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Add: Butter' })).toBeInTheDocument()
    expect(dialog.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'In this meal',
      'Leftovers',
      'In the pantry',
    ])
  })

  it('leaves staples and seasonings out of the pantry until they are searched for', async () => {
    const { dialog, user } = renderPicker({
      pantryItems: [
        ...fridgePantryItems,
        createPantryItem({
          ingredientId: 'pepper',
          ingredient: { id: 'pepper', name: 'Black pepper', category: 'spice', defaultUnit: 'g' },
        }),
        createPantryItem({
          ingredientId: 'rice',
          isStaple: true,
          ingredient: { id: 'rice', name: 'Rice', category: 'carb', defaultUnit: 'g' },
        }),
        // A herb is a vegetable by category: only its subcategory says herb.
        createPantryItem({
          ingredientId: 'parsley',
          ingredient: {
            id: 'parsley',
            name: 'Curly parsley',
            category: 'vegetable',
            subcategory: 'herb',
            defaultUnit: 'g',
          },
        }),
      ],
    })

    expect(dialog.getByRole('button', { name: 'Add: Cucumber' })).toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: 'Add: Black pepper' })).not.toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: 'Add: Rice' })).not.toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: 'Add: Curly parsley' })).not.toBeInTheDocument()

    await user.type(dialog.getByLabelText('What are you having?'), 'pep')
    expect(dialog.getByRole('button', { name: 'Add: Black pepper' })).toBeInTheDocument()
    await user.clear(dialog.getByLabelText('What are you having?'))
    await user.type(dialog.getByLabelText('What are you having?'), 'ric')
    expect(dialog.getByRole('button', { name: 'Add: Rice' })).toBeInTheDocument()
  })

  it('filters the leftovers by the field too', async () => {
    const { dialog, user } = renderPicker()
    await dialog.findByRole('button', { name: 'Add: Mash, from Tuesday' })

    await user.type(dialog.getByLabelText('What are you having?'), 'soup')

    expect(
      dialog.getByRole('button', { name: 'Add: Lentil soup, from Monday' }),
    ).toBeInTheDocument()
    expect(
      dialog.queryByRole('button', { name: 'Add: Mash, from Tuesday' }),
    ).not.toBeInTheDocument()
  })

  it('adds the pantry item that Enter names exactly, and the words otherwise', async () => {
    const { dialog, user } = renderPicker()
    const field = dialog.getByLabelText('What are you having?')

    await user.type(field, 'cucumber{Enter}')
    await user.type(field, 'pelmeenid{Enter}')

    expect(chosen(dialog)).toEqual(['Cucumber pantry', 'pelmeenid'])
    expect(field).toHaveValue('')
    expect(field).toHaveFocus()
  })

  it('filters the pantry by the search, and drops an added item from the matches', async () => {
    const { dialog, user } = renderPicker()

    await user.type(dialog.getByLabelText('What are you having?'), 'cuc')

    const add = dialog.getByRole('button', { name: 'Add: Cucumber' })
    expect(dialog.queryByRole('button', { name: 'Add: Paprika' })).not.toBeInTheDocument()
    await user.click(add)

    expect(chosen(dialog)).toEqual(['Cucumber pantry'])
    expect(dialog.queryByRole('button', { name: 'Add: Cucumber' })).not.toBeInTheDocument()
  })

  // HON-1287: an add from the search clears it, so the picker does not read
  // "Nothing matches" as if the add failed; the chip unmounts, so focus moves
  // to the search, not to <body>.
  it('clears the search after a pantry chip add and moves focus to it', async () => {
    const { dialog, user } = renderPicker()
    const search = dialog.getByLabelText('What are you having?')

    await user.type(search, 'pap')
    await user.click(dialog.getByRole('button', { name: 'Add: Paprika' }))

    expect(chosen(dialog)).toEqual(['Paprika pantry'])
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    // The full list is back, less the item just added.
    expect(dialog.getByRole('button', { name: 'Add: Butter' })).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Add: Cucumber' })).toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: /^Add "/ })).not.toBeInTheDocument()
  })

  it('moves focus to the search after a leftovers chip add', async () => {
    const { dialog, user } = renderPicker()

    await user.click(await dialog.findByRole('button', { name: 'Add: Mash, from Tuesday' }))

    expect(chosen(dialog)).toEqual(['Mash, from Tuesday'])
    expect(dialog.getByLabelText('What are you having?')).toHaveFocus()
  })

  it("adds an unmatched search as the household's own words", async () => {
    const { dialog, onSaved, user } = renderPicker({
      pantryItems: fridgePantryItems.filter((p) => p.ingredientId !== 'cucumber'),
    })
    const search = dialog.getByLabelText('What are you having?')

    await user.type(search, '  cucumber ')
    await user.click(dialog.getByRole('button', { name: 'Add "cucumber"' }))

    expect(chosen(dialog)).toEqual(['cucumber'])
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(saves()[0]!.body).toMatchObject({ fridgeItems: [{ label: 'cucumber' }] })
  })

  it('does not offer the words of a pantry item already in the meal', async () => {
    const { dialog, user } = renderPicker()
    const search = dialog.getByLabelText('What are you having?')

    await user.type(search, 'cuc')
    await user.click(dialog.getByRole('button', { name: 'Add: Cucumber' }))
    await user.type(search, 'cucumber')

    expect(dialog.queryByRole('button', { name: 'Add "cucumber"' })).not.toBeInTheDocument()
    // Enter on it adds nothing either: no free-text copy of a pantry item.
    await user.keyboard('{Enter}')
    expect(chosen(dialog)).toEqual(['Cucumber pantry'])
  })

  it('cuts an unmatched search to the label limit', async () => {
    const { dialog, user } = renderPicker()

    await user.type(dialog.getByLabelText('What are you having?'), 'x'.repeat(90))
    await user.click(dialog.getByRole('button', { name: /^Add "x+"$/ }))

    expect(chosen(dialog)).toEqual(['x'.repeat(80)])
  })

  it('keeps the unmatched-search button, aria-disabled, when the meal has 30 items (the limit)', async () => {
    const full = Array.from({ length: 30 }, (_, i) => freeTextItem(`thing ${i + 1}`))
    const { dialog, user } = renderPicker({ initialItems: full })

    await user.type(dialog.getByLabelText('What are you having?'), 'tofu')
    const add = dialog.getByRole('button', { name: 'Add "tofu"' })
    expect(add).toHaveAttribute('aria-disabled', 'true')
    await user.click(add)

    expect(chosen(dialog)).toHaveLength(30)
    expect(chosen(dialog)).not.toContain('tofu')
    // Not `disabled`, so focus stays on it (HON-803).
    expect(add).toHaveFocus()
  })

  // "Used it all" leaves a row at 0, which means ran out (HON-1277).
  it('does not offer a pantry item the household has run out of', () => {
    const ranOut = fridgePantryItems.map((p) =>
      p.ingredientId === 'cucumber' ? { ...p, quantity: 0 } : p,
    )
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
          pantryItems={ranOut}
          onSaved={vi.fn()}
        />
      </Wrapper>,
    )
    const dialog = within(screen.getByRole('dialog', { name: 'Fridge meal' }))

    expect(dialog.queryByRole('button', { name: 'Add: Cucumber' })).not.toBeInTheDocument()
    // Unknown amount (null) is still at home.
    expect(dialog.getByRole('button', { name: 'Add: Butter' })).toBeInTheDocument()
  })

  it('offers the words, and no pantry section, when nothing in the pantry matches', async () => {
    const { dialog, user } = renderPicker()

    await user.type(dialog.getByLabelText('What are you having?'), 'tofu')

    expect(dialog.getByRole('button', { name: 'Add "tofu"' })).toBeInTheDocument()
    expect(dialog.queryByRole('heading', { name: 'In the pantry' })).not.toBeInTheDocument()
  })

  it('creates the fridge meal in the slot with the items in the order added', async () => {
    const { dialog, onSaved, onOpenChange, user } = renderPicker()

    await user.click(await dialog.findByRole('button', { name: 'Add: Mash, from Tuesday' }))
    await user.click(dialog.getByRole('button', { name: 'Add: Cucumber' }))
    await user.type(dialog.getByLabelText('What are you having?'), 'store meatballs{Enter}')
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

    // Only the pantry items get a "Used it all" tick later, so only they are marked.
    expect(chosen(dialog)).toEqual([
      'Mash, from Tuesday',
      'Cauliflower and broccoli mix pantry',
      'Cucumber pantry',
      'store meatballs',
    ])
    // The marker is not part of the item's name.
    expect(dialog.getByRole('button', { name: 'Remove: Cucumber' })).toBeInTheDocument()
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
  // HON-1396: the list is the source rule's for this slot, so tonight's
  // planned dinner is a source for tomorrow's lunch.
  it("asks for the slot's sources and marks a planned one", async () => {
    leftoverSources = [fridgePlannedSource, ...fridgeRecentMeals]
    const { dialog } = renderPicker({ date: '2026-10-22', mealType: 'lunch' })

    expect(
      await dialog.findByRole('button', { name: 'Add: Chicken curry, from Wednesday · planned' }),
    ).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Add: Mash, from Tuesday' })).toBeInTheDocument()
    expect(requests[0]!.url).toBe('/api/entries/recent?date=2026-10-22&mealType=lunch')
  })

  it("starts a planned source at the household's servings and saves the servings set", async () => {
    leftoverSources = [fridgePlannedSource, ...fridgeRecentMeals]
    const { dialog, onSaved, user } = renderPicker({ date: '2026-10-22', mealType: 'lunch' })

    await user.click(
      await dialog.findByRole('button', { name: 'Add: Chicken curry, from Wednesday · planned' }),
    )
    expect(chosen(dialog)).toEqual(['Chicken curry, from Wednesday planned'])
    const servings = servingsOf(dialog, 'Chicken curry, from Wednesday')
    expect(servings.getByText('2 servings')).toBeInTheDocument()
    await user.click(servings.getByRole('button', { name: 'More servings' }))
    expect(servings.getByText('2.5 servings')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(saves()[0]!.body).toEqual({
      date: '2026-10-22',
      mealType: 'lunch',
      fridgeItems: [{ sourceEntryId: 'entry-curry', servings: 2.5 }],
    })
  })

  it('keeps the servings in 0.5 to 20', async () => {
    const at = (servings: number) => ({ ...plannedLeftoverItem, servings })
    const { dialog, user } = renderPicker({ entryId: 'entry-1', initialItems: [at(0.5)] })
    const servings = servingsOf(dialog, 'Roast chicken, from Tuesday')
    const fewer = servings.getByRole('button', { name: 'Fewer servings' })

    expect(fewer).toHaveAttribute('aria-disabled', 'true')
    await user.click(fewer)
    expect(servings.getByText('0.5 servings')).toBeInTheDocument()
    await user.click(servings.getByRole('button', { name: 'More servings' }))
    expect(servings.getByText('1 serving')).toBeInTheDocument()
  })

  it('shows the stored servings in Edit items and sends them back unchanged', async () => {
    const { dialog, onSaved, user } = renderPicker({
      entryId: 'entry-1',
      initialItems: [plannedLeftoverItem],
      date: '2026-10-21',
      mealType: 'lunch',
    })

    expect(
      servingsOf(dialog, 'Roast chicken, from Tuesday').getByText('2.5 servings'),
    ).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(saves()[0]!.body).toEqual({
      fridgeItems: [{ sourceEntryId: 'entry-roast', servings: 2.5 }],
    })
  })

  it('leaves a cooked source unset until + sets it', async () => {
    const { dialog, user } = renderPicker()

    await user.click(await dialog.findByRole('button', { name: 'Add: Mash, from Tuesday' }))
    const servings = servingsOf(dialog, 'Mash, from Tuesday')
    expect(servings.getByText('Servings not set')).toBeInTheDocument()
    await user.click(servings.getByRole('button', { name: 'More servings' }))

    expect(servings.getByText('2 servings')).toBeInTheDocument()
  })

  it('shows catalog copy when the source rule refuses a leftover', async () => {
    saveStatus = 400
    saveBody = { error: 'Leftover source refused', code: 'leftover_source', problem: 'skipped' }
    const { dialog, onSaved, user } = renderPicker({
      entryId: 'entry-1',
      initialItems: [plannedLeftoverItem],
    })

    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "One of the leftovers can't be used for this meal any more. Remove it and try again.",
      ),
    )
    expect(onSaved).not.toHaveBeenCalled()
  })
})

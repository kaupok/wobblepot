import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MealForm } from './MealForm'
import type { IngredientResult } from './meal-form-types'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const tomato: IngredientResult = {
  id: 'tomato',
  name: 'Tomato',
  category: 'vegetable',
  defaultUnit: 'g',
}
const egg: IngredientResult = { id: 'egg', name: 'Egg', category: 'protein', defaultUnit: 'piece' }

/** Answers the ingredient search by query; records any other request, such as a save. */
function mockApi() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const search = new URL(url, 'http://localhost').searchParams.get('search') ?? ''
    const ingredients = [tomato, egg].filter((i) => i.name.toLowerCase().startsWith(search))
    return new Response(JSON.stringify({ ingredients }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

function saveRequests(fetchSpy: ReturnType<typeof mockApi>) {
  return fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST')
}

function renderForm() {
  const { wrapper } = createQueryWrapper()
  return render(<MealForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper })
}

async function search(user: ReturnType<typeof userEvent.setup>, text: string) {
  const field = screen.getByRole('combobox', { name: 'Search ingredients to add' })
  await user.type(field, text)
  await vi.advanceTimersByTimeAsync(350)
  await screen.findAllByRole('option')
  return field
}

// HON-1362: type, Enter, type the quantity, Enter, type the next ingredient.
describe('MealForm adds ingredients from the keyboard', () => {
  let fetchSpy: ReturnType<typeof mockApi>
  // jsdom has no scrollIntoView; the form scrolls each focused field clear of
  // the phone tab bar.
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchSpy = mockApi()
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })

  it('adds the top result on Enter and focuses its empty quantity field', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderForm()

    await search(user, 'tomat')
    await user.keyboard('{Enter}')

    const quantity = screen.getByRole('textbox', { name: 'Total quantity for Tomato' })
    expect(quantity).toHaveFocus()
    expect(quantity).toHaveValue('')
    expect(quantity).toHaveAttribute('placeholder', '100')
    // Scrolled to with its tab-bar margin, so a phone does not hide it under the bar.
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(quantity)
    expect(scrollIntoView).toHaveBeenLastCalledWith(expect.objectContaining({ block: 'nearest' }))
    expect(quantity).toHaveClass('scroll-mb-above-tab-bar')
  })

  it('returns to the empty search on Enter in the quantity field, without saving', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderForm()

    const field = await search(user, 'tomat')
    await user.keyboard('{Enter}')
    await user.keyboard('300{Enter}')

    expect(field).toHaveFocus()
    expect(field).toHaveValue('')
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(field)
    expect(field).toHaveClass('scroll-mb-above-tab-bar')
    expect(screen.getByRole('textbox', { name: 'Total quantity for Tomato' })).toHaveValue('300')
    expect(saveRequests(fetchSpy)).toHaveLength(0)

    // The next ingredient follows the same way.
    await search(user, 'egg')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox', { name: 'Total quantity for Egg' })).toHaveFocus()
  })

  it('focuses the new quantity field after a click on a result', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderForm()

    await search(user, 'egg')
    await user.click(screen.getByRole('option', { name: /Egg/ }))

    const quantity = screen.getByRole('textbox', { name: 'Total quantity for Egg' })
    expect(quantity).toHaveFocus()
    expect(quantity).toHaveValue('')
    expect(quantity).toHaveAttribute('placeholder', '1')
  })

  it('flags an empty quantity only on save, and focuses that field', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderForm()

    await user.type(screen.getByLabelText('Recipe name'), 'Salad')
    await search(user, 'tomat')
    await user.keyboard('{Enter}')
    await user.keyboard('300{Enter}')
    await search(user, 'egg')
    await user.keyboard('{Enter}')

    const eggQuantity = screen.getByRole('textbox', { name: 'Total quantity for Egg' })
    expect(eggQuantity).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('Quantity must be greater than 0')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create recipe' }))

    expect(eggQuantity).toHaveFocus()
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(eggQuantity)
    expect(eggQuantity).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Quantity must be greater than 0')).toBeInTheDocument()
    expect(screen.getByText(/Quantity must be greater than 0: Egg/)).toBeInTheDocument()
    expect(saveRequests(fetchSpy)).toHaveLength(0)
  })

  it('does not flag a row added after a failed save', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderForm()

    await user.type(screen.getByLabelText('Recipe name'), 'Salad')
    const servings = screen.getByLabelText('Recipe makes (servings)')
    await user.clear(servings)
    await user.type(servings, '0')
    await search(user, 'egg')
    await user.keyboard('{Enter}')
    // Fails on the servings, and finds the egg quantity empty.
    await user.click(screen.getByRole('button', { name: 'Create recipe' }))
    const eggQuantity = screen.getByRole('textbox', { name: 'Total quantity for Egg' })
    expect(eggQuantity).toHaveAttribute('aria-invalid', 'true')

    await search(user, 'tomat')
    await user.keyboard('{Enter}')

    const tomatoQuantity = screen.getByRole('textbox', { name: 'Total quantity for Tomato' })
    expect(tomatoQuantity).toHaveFocus()
    expect(tomatoQuantity).not.toHaveAttribute('aria-invalid')
    expect(eggQuantity).toHaveAttribute('aria-invalid', 'true')
    expect(saveRequests(fetchSpy)).toHaveLength(0)
  })
})

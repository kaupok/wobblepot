import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  groupOf,
  makeItem,
  pressedStock,
  renderSection,
  renderStateful,
  stockOf,
  stockPart,
} from './PantrySection.fixtures'

// `toast` is callable (the Undo toast) and carries `error` / `success`.
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

// A row at 0 has run out (HON-1288): it leaves On hand for its own group, and
// its Have it sets the quantity back to null, "have some" (HON-1535, HON-1624).
describe('PantrySection ran out', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const avocado = makeItem({
    id: 'pantry-avocado',
    ingredient: { id: 'ing-avocado', name: 'Avocado', category: 'fruit', defaultUnit: 'piece' },
    quantity: 0,
  })
  const lime = makeItem({
    id: 'pantry-lime',
    ingredient: { id: 'ing-lime', name: 'Lime', category: 'fruit', defaultUnit: 'piece' },
    quantity: 0,
  })
  const bread = makeItem({
    id: 'pantry-bread',
    ingredient: { id: 'ing-bread', name: 'Bread', category: 'carb', defaultUnit: 'piece' },
    quantity: null,
  })
  const salt = makeItem({
    id: 'pantry-salt',
    ingredient: { id: 'ing-salt', name: 'Salt', category: 'spice', defaultUnit: 'g' },
    quantity: 0,
    isStaple: true,
  })

  it('puts a non-staple row at 0 under Ran out, and a staple at 0 under Staples', () => {
    renderSection([salt, bread, avocado])

    expect(groupOf('Avocado')).toBe('Ran out 1')
    expect(groupOf('Bread')).toBe('On hand 1')
    expect(groupOf('Salt')).toBe('Staples (always stocked) 1')
    expect(screen.getByRole('heading', { level: 3, name: 'Ran out 1' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'On hand 1' })).toBeInTheDocument()
    // The title still counts every row.
    expect(screen.getByText('3 items')).toBeInTheDocument()
  })

  it('renders no Ran out heading when no row is at 0', () => {
    renderSection([bread, makeItem({ quantity: 2 })])

    expect(screen.queryByRole('heading', { name: /^Ran out/ })).not.toBeInTheDocument()
    for (const pressed of screen.getAllByRole('radio', { checked: true })) {
      expect(pressed).toHaveAccessibleName('Have it')
    }
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(2)
  })

  it('gives every row one stock control, Have it above 0 and Ran out at 0, and no Ran out or Have it button', () => {
    const butter = makeItem({ quantity: 2 })
    const oil = makeItem({
      id: 'pantry-oil',
      ingredient: { id: 'ing-oil', name: 'Olive oil', category: 'fat', defaultUnit: 'g' },
      isStaple: true,
    })
    renderSection([salt, oil, bread, butter, avocado])

    expect(screen.getAllByRole('radiogroup').map((g) => g.getAttribute('aria-label'))).toEqual([
      'Stock: Salt',
      'Stock: Olive oil',
      'Stock: Bread',
      'Stock: Butter',
      'Stock: Avocado',
    ])
    expect(pressedStock('Salt')).toHaveAccessibleName('Ran out')
    expect(pressedStock('Olive oil')).toHaveAccessibleName('Have it')
    expect(pressedStock('Bread')).toHaveAccessibleName('Have it')
    expect(pressedStock('Butter')).toHaveAccessibleName('Have it')
    expect(pressedStock('Avocado')).toHaveAccessibleName('Ran out')
    expect(screen.queryByRole('button', { name: /^(Ran out|Have it)/ })).not.toBeInTheDocument()
  })

  it('gives each row one stock control of three parts and no switch', () => {
    renderSection([salt, bread, avocado])

    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    for (const name of ['Salt', 'Bread', 'Avocado']) {
      const row = screen.getByText(name).closest('.p-3') as HTMLElement
      expect(within(row).getAllByRole('radiogroup')).toHaveLength(1)
      expect(
        within(stockOf(name))
          .getAllByRole('radio')
          .map((r) => r.textContent),
      ).toEqual(['Have it', 'Low', 'Ran out'])
      expect(within(stockOf(name)).getAllByRole('radio', { checked: true })).toHaveLength(1)
    }
    // A row at 0 has Ran out pressed, a staple at 0 too.
    expect(stockPart('Avocado', 'Ran out')).toHaveAttribute('aria-checked', 'true')
    expect(stockPart('Salt', 'Ran out')).toHaveAttribute('aria-checked', 'true')
    expect(stockPart('Bread', 'Ran out')).toHaveAttribute('aria-checked', 'false')
  })

  it('names the item in the group and marks the pressed part checked for a screen reader', () => {
    renderSection([bread])

    const group = screen.getByRole('radiogroup', { name: /Bread/ })
    expect(group).toHaveAccessibleName('Stock: Bread')
    expect(within(group).getByRole('radio', { name: 'Have it' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(group).getByRole('radio', { name: 'Low' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(within(group).getByRole('radio', { name: 'Ran out' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('sends nothing on a press of the part already pressed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    renderStateful([bread, avocado])

    fireEvent.click(stockPart('Bread', 'Have it'))
    fireEvent.click(stockPart('Avocado', 'Ran out'))
    await act(async () => {})

    expect(fetchMock).not.toHaveBeenCalled()
    expect(pressedStock('Bread')).toHaveAccessibleName('Have it')
    expect(pressedStock('Avocado')).toHaveAccessibleName('Ran out')
  })

  it('sends quantity null and moves the row to On hand', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const onPantryQuantityChanged = vi.fn()
    renderStateful([bread, avocado], onPantryQuantityChanged)

    fireEvent.click(stockPart('Avocado', 'Have it'))

    await waitFor(() => expect(groupOf('Avocado')).toBe('On hand 2'))
    // The shopping list beside it re-reads, because a null row is not bought.
    await waitFor(() => expect(onPantryQuantityChanged).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('heading', { name: /^Ran out/ })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-avocado', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"quantity":null}',
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('puts the row back under Ran out and toasts on a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    const onPantryQuantityChanged = vi.fn()
    renderStateful([bread, avocado], onPantryQuantityChanged)

    fireEvent.click(stockPart('Avocado', 'Have it'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(onPantryQuantityChanged).not.toHaveBeenCalled()
    expect(groupOf('Avocado')).toBe('Ran out 1')
    expect(pressedStock('Avocado')).toHaveAccessibleName('Ran out')
  })

  it("focuses the moved row's own Have it in On hand, not <body>", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
    renderStateful([bread, avocado, lime])
    const control = stockPart('Avocado', 'Have it')
    control.focus()

    fireEvent.click(control)

    // jsdom, like a browser, moves focus to <body> when the focused part
    // unmounts with its row, so this fails without the refocus.
    await waitFor(() => expect(groupOf('Avocado')).toBe('On hand 2'))
    const moved = stockPart('Avocado', 'Have it')
    expect(moved).toHaveAttribute('aria-checked', 'true')
    expect(moved).toHaveFocus()
    expect(document.body).not.toHaveFocus()
  })
})

// Ran out sets a row to 0 from the pantry tab (HON-1399, HON-1624): an ordinary row
// moves to Ran out, a staple stays in Staples and goes on the shopping list.
describe('PantrySection marking a row ran out', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const bread = makeItem({
    id: 'pantry-bread',
    ingredient: { id: 'ing-bread', name: 'Bread', category: 'carb', defaultUnit: 'piece' },
    quantity: null,
  })
  const eggs = makeItem({
    id: 'pantry-eggs',
    ingredient: { id: 'ing-eggs', name: 'Eggs', category: 'protein', defaultUnit: 'piece' },
    quantity: null,
    isStaple: true,
  })

  it('Ran out sends quantity 0, moves an On hand row to Ran out and keeps focus on its Ran out part', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const onPantryQuantityChanged = vi.fn()
    renderStateful([eggs, bread], onPantryQuantityChanged)
    const control = stockPart('Bread', 'Ran out')
    control.focus()

    fireEvent.click(control)

    await waitFor(() => expect(groupOf('Bread')).toBe('Ran out 1'))
    const moved = stockPart('Bread', 'Ran out')
    expect(moved).toHaveAttribute('aria-checked', 'true')
    expect(moved).toHaveFocus()
    expect(screen.queryByRole('heading', { name: /^On hand/ })).not.toBeInTheDocument()
    // The shopping list beside it re-reads.
    await waitFor(() => expect(onPantryQuantityChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-bread', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"quantity":0}',
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('keeps a staple in Staples on Ran out, presses Ran out and keeps focus on it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
    const onPantryQuantityChanged = vi.fn()
    renderStateful([eggs, bread], onPantryQuantityChanged)
    const control = stockPart('Eggs', 'Ran out')
    control.focus()

    fireEvent.click(control)

    await waitFor(() => expect(pressedStock('Eggs')).toHaveAccessibleName('Ran out'))
    expect(stockPart('Eggs', 'Ran out')).toHaveFocus()
    expect(groupOf('Eggs')).toBe('Staples (always stocked) 1')
    expect(screen.queryByRole('heading', { name: /^Ran out/ })).not.toBeInTheDocument()
    await waitFor(() => expect(onPantryQuantityChanged).toHaveBeenCalledTimes(1))
  })

  it('Have it on a staple at 0 sends null, keeps it in Staples and keeps focus on its Have it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const onPantryQuantityChanged = vi.fn()
    renderStateful([{ ...eggs, quantity: 0 }, bread], onPantryQuantityChanged)
    const control = stockPart('Eggs', 'Have it')
    control.focus()

    fireEvent.click(control)

    await waitFor(() => expect(pressedStock('Eggs')).toHaveAccessibleName('Have it'))
    expect(stockPart('Eggs', 'Have it')).toHaveFocus()
    expect(document.body).not.toHaveFocus()
    expect(groupOf('Eggs')).toBe('Staples (always stocked) 1')
    await waitFor(() => expect(onPantryQuantityChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-eggs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"quantity":null}',
    })
  })

  it('puts the row back, focuses its Have it and toasts on a failed Ran out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    const onPantryQuantityChanged = vi.fn()
    renderStateful([eggs, bread], onPantryQuantityChanged)
    const control = stockPart('Bread', 'Ran out')
    control.focus()

    fireEvent.click(control)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(groupOf('Bread')).toBe('On hand 1')
    const back = stockPart('Bread', 'Have it')
    expect(back).toHaveAttribute('aria-checked', 'true')
    expect(back).toHaveFocus()
    expect(onPantryQuantityChanged).not.toHaveBeenCalled()
  })

  it('puts a staple back at 0 and focuses its Ran out when Have it fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    renderStateful([{ ...eggs, quantity: 0 }])
    const control = stockPart('Eggs', 'Have it')
    control.focus()

    fireEvent.click(control)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    const back = stockPart('Eggs', 'Ran out')
    expect(back).toHaveAttribute('aria-checked', 'true')
    expect(back).toHaveFocus()
  })

  it('Have it after Ran out sends back the count the row had, not null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const butter = makeItem({ quantity: 2 })
    renderStateful([butter])

    fireEvent.click(stockPart('Butter', 'Ran out'))
    await waitFor(() => expect(groupOf('Butter')).toBe('Ran out 1'))
    fireEvent.click(stockPart('Butter', 'Have it'))

    await waitFor(() => expect(groupOf('Butter')).toBe('On hand 1'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/pantry/pantry-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"quantity":2}',
    })
  })

  it('sends Have it only after the Ran out it undoes has landed', async () => {
    let landRanOut: (response: Response) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => (landRanOut = resolve)))
      .mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    renderStateful([bread])

    fireEvent.click(stockPart('Bread', 'Ran out'))
    // The row moves at once, before the request answers.
    fireEvent.click(stockPart('Bread', 'Have it'))
    expect(groupOf('Bread')).toBe('On hand 1')
    await act(async () => {})
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => landRanOut(Response.json({ ok: true })))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls.map(([, init]) => init.body)).toEqual([
      '{"quantity":0}',
      '{"quantity":null}',
    ])
  })

  it('keeps the count a newer Ran out saved while an older Have it was queued', async () => {
    let landFirst: (response: Response) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => (landFirst = resolve)))
      .mockImplementation(() => Promise.resolve(Response.json({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    renderStateful([makeItem({ quantity: 2 })])

    // Three taps inside the first request's time: they queue behind it.
    fireEvent.click(stockPart('Butter', 'Ran out'))
    fireEvent.click(stockPart('Butter', 'Have it'))
    fireEvent.click(stockPart('Butter', 'Ran out'))
    await act(async () => landFirst(Response.json({ ok: true })))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await act(async () => {})

    fireEvent.click(stockPart('Butter', 'Have it'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(fetchMock.mock.calls.map(([, init]) => init.body)).toEqual([
      '{"quantity":0}',
      '{"quantity":2}',
      '{"quantity":0}',
      '{"quantity":2}',
    ])
  })
})

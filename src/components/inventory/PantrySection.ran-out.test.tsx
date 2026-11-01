import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { groupOf, makeItem, renderSection, renderStateful } from './PantrySection.fixtures'

// `toast` is callable (the Undo toast) and carries `error` / `success`.
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

// A row at 0 has run out (HON-1288): it leaves On hand for its own group, and
// its switch going on sets the quantity back to null, "have some" (HON-1535).
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
    for (const control of screen.getAllByRole('switch')) expect(control).toBeChecked()
  })

  it('gives every row one switch, on above 0 and off at 0, and no Ran out or Have it button', () => {
    const butter = makeItem({ quantity: 2 })
    const oil = makeItem({
      id: 'pantry-oil',
      ingredient: { id: 'ing-oil', name: 'Olive oil', category: 'fat', defaultUnit: 'g' },
      isStaple: true,
    })
    renderSection([salt, oil, bread, butter, avocado])

    expect(screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual([
      'Have it: Salt',
      'Have it: Olive oil',
      'Have it: Bread',
      'Have it: Butter',
      'Have it: Avocado',
    ])
    expect(screen.getByRole('switch', { name: 'Have it: Salt' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Have it: Olive oil' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Have it: Bread' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Have it: Butter' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Have it: Avocado' })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: /^(Ran out|Have it)/ })).not.toBeInTheDocument()
  })

  it('names the state beside the switch once per row, never both words', () => {
    renderSection([salt, bread, avocado])

    const row = (name: string) => screen.getByText(name).closest('.p-3') as HTMLElement
    // A staple at 0 lost its own "Ran out" caption: the state word says it.
    expect(within(row('Salt')).getAllByText('Ran out')).toHaveLength(1)
    expect(within(row('Salt')).queryByText('Have it')).not.toBeInTheDocument()
    expect(within(row('Avocado')).getAllByText('Ran out')).toHaveLength(1)
    expect(within(row('Avocado')).queryByText('Have it')).not.toBeInTheDocument()
    expect(within(row('Bread')).getAllByText('Have it')).toHaveLength(1)
    expect(within(row('Bread')).queryByText('Ran out')).not.toBeInTheDocument()
  })

  it('sends quantity null and moves the row to On hand', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const onPantryQuantityChanged = vi.fn()
    renderStateful([bread, avocado], onPantryQuantityChanged)

    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Avocado' }))

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

    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Avocado' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(onPantryQuantityChanged).not.toHaveBeenCalled()
    expect(groupOf('Avocado')).toBe('Ran out 1')
    expect(screen.getByRole('switch', { name: 'Have it: Avocado' })).not.toBeChecked()
  })

  it("focuses the moved row's own switch in On hand, not <body>", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
    renderStateful([bread, avocado, lime])
    const control = screen.getByRole('switch', { name: 'Have it: Avocado' })
    control.focus()

    fireEvent.click(control)

    // jsdom, like a browser, moves focus to <body> when the focused switch
    // unmounts with its row, so this fails without the refocus.
    await waitFor(() => expect(groupOf('Avocado')).toBe('On hand 2'))
    const moved = screen.getByRole('switch', { name: 'Have it: Avocado' })
    expect(moved).toBeChecked()
    expect(moved).toHaveFocus()
    expect(document.body).not.toHaveFocus()
  })
})

// Switch-off sets a row to 0 from the pantry tab (HON-1399): an ordinary row
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

  it('switch-off sends quantity 0, moves an On hand row to Ran out and keeps focus on its switch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const onPantryQuantityChanged = vi.fn()
    renderStateful([eggs, bread], onPantryQuantityChanged)
    const control = screen.getByRole('switch', { name: 'Have it: Bread' })
    control.focus()

    fireEvent.click(control)

    await waitFor(() => expect(groupOf('Bread')).toBe('Ran out 1'))
    const moved = screen.getByRole('switch', { name: 'Have it: Bread' })
    expect(moved).not.toBeChecked()
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

  it('keeps a staple in Staples on switch-off, says "Ran out" and keeps focus on its switch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
    const onPantryQuantityChanged = vi.fn()
    renderStateful([eggs, bread], onPantryQuantityChanged)
    const control = screen.getByRole('switch', { name: 'Have it: Eggs' })
    control.focus()

    fireEvent.click(control)

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Have it: Eggs' })).not.toBeChecked(),
    )
    expect(screen.getByRole('switch', { name: 'Have it: Eggs' })).toHaveFocus()
    expect(groupOf('Eggs')).toBe('Staples (always stocked) 1')
    expect(screen.queryByRole('heading', { name: /^Ran out/ })).not.toBeInTheDocument()
    const row = screen.getByText('Eggs').closest('.p-3') as HTMLElement
    expect(within(row).getAllByText('Ran out')).toHaveLength(1)
    expect(within(row).queryByText('Have it')).not.toBeInTheDocument()
    await waitFor(() => expect(onPantryQuantityChanged).toHaveBeenCalledTimes(1))
  })

  it('switch-on on a staple at 0 sends null, keeps it in Staples and keeps focus on its switch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const onPantryQuantityChanged = vi.fn()
    renderStateful([{ ...eggs, quantity: 0 }, bread], onPantryQuantityChanged)
    const control = screen.getByRole('switch', { name: 'Have it: Eggs' })
    control.focus()

    fireEvent.click(control)

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Have it: Eggs' })).toBeChecked())
    expect(screen.getByRole('switch', { name: 'Have it: Eggs' })).toHaveFocus()
    expect(document.body).not.toHaveFocus()
    expect(groupOf('Eggs')).toBe('Staples (always stocked) 1')
    const row = screen.getByText('Eggs').closest('.p-3') as HTMLElement
    expect(within(row).getAllByText('Have it')).toHaveLength(1)
    expect(within(row).queryByText('Ran out')).not.toBeInTheDocument()
    await waitFor(() => expect(onPantryQuantityChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-eggs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"quantity":null}',
    })
  })

  it('puts the row back, keeps focus on its switch and toasts on a failed switch-off', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    const onPantryQuantityChanged = vi.fn()
    renderStateful([eggs, bread], onPantryQuantityChanged)
    const control = screen.getByRole('switch', { name: 'Have it: Bread' })
    control.focus()

    fireEvent.click(control)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(groupOf('Bread')).toBe('On hand 1')
    const back = screen.getByRole('switch', { name: 'Have it: Bread' })
    expect(back).toBeChecked()
    expect(back).toHaveFocus()
    expect(onPantryQuantityChanged).not.toHaveBeenCalled()
  })

  it('puts a staple back at 0 and keeps focus on its switch when switch-on fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    renderStateful([{ ...eggs, quantity: 0 }])
    const control = screen.getByRole('switch', { name: 'Have it: Eggs' })
    control.focus()

    fireEvent.click(control)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    const back = screen.getByRole('switch', { name: 'Have it: Eggs' })
    expect(back).not.toBeChecked()
    expect(back).toHaveFocus()
    const row = screen.getByText('Eggs').closest('.p-3') as HTMLElement
    expect(within(row).getByText('Ran out')).toBeInTheDocument()
  })

  it('switch-on after switch-off sends back the count the row had, not null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const butter = makeItem({ quantity: 2 })
    renderStateful([butter])

    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Butter' }))
    await waitFor(() => expect(groupOf('Butter')).toBe('Ran out 1'))
    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Butter' }))

    await waitFor(() => expect(groupOf('Butter')).toBe('On hand 1'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/pantry/pantry-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"quantity":2}',
    })
  })

  it('sends switch-on only after the switch-off it undoes has landed', async () => {
    let landRanOut: (response: Response) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => (landRanOut = resolve)))
      .mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    renderStateful([bread])

    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Bread' }))
    // The row moves at once, before the request answers.
    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Bread' }))
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

  it('keeps the count a newer switch-off saved while an older switch-on was queued', async () => {
    let landFirst: (response: Response) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => (landFirst = resolve)))
      .mockImplementation(() => Promise.resolve(Response.json({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    renderStateful([makeItem({ quantity: 2 })])

    // Three taps inside the first request's time: they queue behind it.
    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Butter' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Butter' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Butter' }))
    await act(async () => landFirst(Response.json({ ok: true })))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await act(async () => {})

    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Butter' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(fetchMock.mock.calls.map(([, init]) => init.body)).toEqual([
      '{"quantity":0}',
      '{"quantity":2}',
      '{"quantity":0}',
      '{"quantity":2}',
    ])
  })
})

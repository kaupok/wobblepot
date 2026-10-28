import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { groupOf, makeItem, renderSection, renderStateful } from './PantrySection.fixtures'

// `toast` is callable (the Undo toast) and carries `error` / `success`.
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

// A row at 0 has run out (HON-1288): it leaves On hand for its own group, with
// a "Have it" that sets the quantity back to null, "have some".
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
    expect(screen.queryByRole('button', { name: /^Have it/ })).not.toBeInTheDocument()
  })

  it('offers "Have it" on each row at 0 and "Ran out" on every other row', () => {
    const butter = makeItem({ quantity: 2 })
    const oil = makeItem({
      id: 'pantry-oil',
      ingredient: { id: 'ing-oil', name: 'Olive oil', category: 'fat', defaultUnit: 'g' },
      isStaple: true,
    })
    renderSection([salt, oil, bread, butter, avocado])

    expect(screen.getAllByRole('button', { name: /^Have it/ })).toEqual([
      screen.getByRole('button', { name: 'Have it: Salt' }),
      screen.getByRole('button', { name: 'Have it: Avocado' }),
    ])
    expect(screen.getAllByRole('button', { name: /^Ran out/ })).toEqual([
      screen.getByRole('button', { name: 'Ran out: Olive oil' }),
      screen.getByRole('button', { name: 'Ran out: Bread' }),
      screen.getByRole('button', { name: 'Ran out: Butter' }),
    ])
  })

  it('says "Ran out" under a staple at 0, not under an ordinary row at 0', () => {
    renderSection([salt, avocado])

    const row = (name: string) => screen.getByText(name).closest('.p-3') as HTMLElement
    expect(within(row('Salt')).getByText('Ran out')).toBeInTheDocument()
    expect(within(row('Avocado')).queryByText('Ran out')).not.toBeInTheDocument()
  })

  it('sends quantity null and moves the row to On hand', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const onPantryQuantityChanged = vi.fn()
    renderStateful([bread, avocado], onPantryQuantityChanged)

    fireEvent.click(screen.getByRole('button', { name: 'Have it: Avocado' }))

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

    fireEvent.click(screen.getByRole('button', { name: 'Have it: Avocado' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(onPantryQuantityChanged).not.toHaveBeenCalled()
    expect(groupOf('Avocado')).toBe('Ran out 1')
    expect(screen.getByRole('button', { name: 'Have it: Avocado' })).toBeInTheDocument()
  })

  it('focuses the next ran-out row\'s "Have it", not <body>', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
    renderStateful([bread, avocado, lime])
    const haveIt = screen.getByRole('button', { name: 'Have it: Avocado' })
    haveIt.focus()

    fireEvent.click(haveIt)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Have it: Lime' })).toHaveFocus())
    expect(document.body).not.toHaveFocus()
  })

  it("focuses the moved row's star once Ran out is empty", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
    renderStateful([avocado])
    const haveIt = screen.getByRole('button', { name: 'Have it: Avocado' })
    haveIt.focus()

    fireEvent.click(haveIt)

    // jsdom, like a browser, moves focus to <body> when the focused button
    // unmounts with its row, so this fails without the refocus.
    await waitFor(() => expect(groupOf('Avocado')).toBe('On hand 1'))
    const star = within(screen.getByText('Avocado').closest('.p-3') as HTMLElement).getByRole(
      'button',
      { name: 'Mark as staple' },
    )
    expect(star).toHaveFocus()
    expect(document.body).not.toHaveFocus()
  })
})

// "Ran out" sets a row to 0 from the pantry tab (HON-1399): an ordinary row
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

  it('sends quantity 0, moves an On hand row to Ran out and focuses its "Have it"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const onPantryQuantityChanged = vi.fn()
    renderStateful([eggs, bread], onPantryQuantityChanged)
    const ranOut = screen.getByRole('button', { name: 'Ran out: Bread' })
    ranOut.focus()

    fireEvent.click(ranOut)

    await waitFor(() => expect(groupOf('Bread')).toBe('Ran out 1'))
    expect(screen.getByRole('button', { name: 'Have it: Bread' })).toHaveFocus()
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

  it('keeps a staple in Staples, says "Ran out" and focuses its "Have it"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
    const onPantryQuantityChanged = vi.fn()
    renderStateful([eggs, bread], onPantryQuantityChanged)
    const ranOut = screen.getByRole('button', { name: 'Ran out: Eggs' })
    ranOut.focus()

    fireEvent.click(ranOut)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Have it: Eggs' })).toHaveFocus())
    expect(groupOf('Eggs')).toBe('Staples (always stocked) 1')
    expect(screen.queryByRole('heading', { name: /^Ran out/ })).not.toBeInTheDocument()
    const row = screen.getByText('Eggs').closest('.p-3') as HTMLElement
    expect(within(row).getByText('Ran out')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ran out: Eggs' })).not.toBeInTheDocument()
    await waitFor(() => expect(onPantryQuantityChanged).toHaveBeenCalledTimes(1))
  })

  it('"Have it" on a staple at 0 sends null, keeps it in Staples and focuses its "Ran out"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const onPantryQuantityChanged = vi.fn()
    renderStateful([{ ...eggs, quantity: 0 }, bread], onPantryQuantityChanged)
    const haveIt = screen.getByRole('button', { name: 'Have it: Eggs' })
    haveIt.focus()

    fireEvent.click(haveIt)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Ran out: Eggs' })).toHaveFocus())
    expect(document.body).not.toHaveFocus()
    expect(groupOf('Eggs')).toBe('Staples (always stocked) 1')
    const row = screen.getByText('Eggs').closest('.p-3') as HTMLElement
    // The button's own text is the only "Ran out" left: the state line is gone.
    expect(within(row).getAllByText('Ran out')).toEqual([
      screen.getByRole('button', { name: 'Ran out: Eggs' }),
    ])
    await waitFor(() => expect(onPantryQuantityChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-eggs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"quantity":null}',
    })
  })

  it('puts the row back, keeps focus on its "Ran out" and toasts on a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    const onPantryQuantityChanged = vi.fn()
    renderStateful([eggs, bread], onPantryQuantityChanged)
    const ranOut = screen.getByRole('button', { name: 'Ran out: Bread' })
    ranOut.focus()

    fireEvent.click(ranOut)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(groupOf('Bread')).toBe('On hand 1')
    expect(screen.getByRole('button', { name: 'Ran out: Bread' })).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Have it: Bread' })).not.toBeInTheDocument()
    expect(onPantryQuantityChanged).not.toHaveBeenCalled()
  })

  it('puts a staple back at 0 and focuses its "Have it" when "Have it" fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    renderStateful([{ ...eggs, quantity: 0 }])
    const haveIt = screen.getByRole('button', { name: 'Have it: Eggs' })
    haveIt.focus()

    fireEvent.click(haveIt)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(screen.getByRole('button', { name: 'Have it: Eggs' })).toHaveFocus()
    const row = screen.getByText('Eggs').closest('.p-3') as HTMLElement
    expect(within(row).getByText('Ran out')).toBeInTheDocument()
  })

  it('"Have it" after "Ran out" sends back the count the row had, not null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const butter = makeItem({ quantity: 2 })
    renderStateful([butter])

    fireEvent.click(screen.getByRole('button', { name: 'Ran out: Butter' }))
    await waitFor(() => expect(groupOf('Butter')).toBe('Ran out 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Have it: Butter' }))

    await waitFor(() => expect(groupOf('Butter')).toBe('On hand 1'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/pantry/pantry-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"quantity":2}',
    })
  })

  it('sends "Have it" only after the "Ran out" it undoes has landed', async () => {
    let landRanOut: (response: Response) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => (landRanOut = resolve)))
      .mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    renderStateful([bread])

    fireEvent.click(screen.getByRole('button', { name: 'Ran out: Bread' }))
    // The row moves at once, before the request answers.
    fireEvent.click(screen.getByRole('button', { name: 'Have it: Bread' }))
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

  it('keeps the count a newer "Ran out" saved while an older "Have it" was queued', async () => {
    let landFirst: (response: Response) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => (landFirst = resolve)))
      .mockImplementation(() => Promise.resolve(Response.json({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    renderStateful([makeItem({ quantity: 2 })])

    // Three taps inside the first request's time: they queue behind it.
    fireEvent.click(screen.getByRole('button', { name: 'Ran out: Butter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Have it: Butter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ran out: Butter' }))
    await act(async () => landFirst(Response.json({ ok: true })))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: 'Have it: Butter' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(fetchMock.mock.calls.map(([, init]) => init.body)).toEqual([
      '{"quantity":0}',
      '{"quantity":2}',
      '{"quantity":0}',
      '{"quantity":2}',
    ])
  })
})

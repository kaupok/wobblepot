import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  groupOf,
  makeItem,
  pressedStock,
  renderSection,
  renderStateful,
  stockPart,
} from './PantrySection.fixtures'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

// The stock control's Low part (HON-1587, HON-1624). Ran out replaces low, so
// a row at 0 has Ran out pressed, not Low (HON-1586).
describe('PantrySection low', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const bread = makeItem({
    id: 'pantry-bread',
    ingredient: { id: 'ing-bread', name: 'Bread', category: 'carb', defaultUnit: 'piece' },
    quantity: null,
  })
  const onion = makeItem({
    id: 'pantry-onion',
    ingredient: { id: 'ing-onion', name: 'Onion', category: 'vegetable', defaultUnit: 'g' },
    quantity: 200,
    low: true,
  })
  const avocado = makeItem({
    id: 'pantry-avocado',
    ingredient: { id: 'ing-avocado', name: 'Avocado', category: 'fruit', defaultUnit: 'piece' },
    quantity: 0,
  })
  const salt = makeItem({
    id: 'pantry-salt',
    ingredient: { id: 'ing-salt', name: 'Salt', category: 'spice', defaultUnit: 'g' },
    isStaple: true,
  })
  const eggs = makeItem({
    id: 'pantry-eggs',
    ingredient: { id: 'ing-eggs', name: 'Eggs', category: 'protein', defaultUnit: 'piece' },
    isStaple: true,
    quantity: 0,
  })
  const okFetch = () => {
    // A new response per call, because a body reads once.
    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('presses Have it on a null row, Low on a low row, Have it on a staple, and Ran out on a ran-out row', () => {
    renderSection([eggs, salt, bread, onion, avocado])

    expect(pressedStock('Bread')).toHaveAccessibleName('Have it')
    expect(pressedStock('Onion')).toHaveAccessibleName('Low')
    expect(pressedStock('Salt')).toHaveAccessibleName('Have it')
    expect(stockPart('Bread', 'Low')).toHaveTextContent('Low')
    expect(pressedStock('Avocado')).toHaveAccessibleName('Ran out')
    // A staple at 0 stays under Staples, and ran out replaces low there too.
    expect(pressedStock('Eggs')).toHaveAccessibleName('Ran out')
    // A low row stays in its group.
    expect(groupOf('Onion')).toBe('On hand 2')
  })

  it('sends low true on Low and low false on Have it', async () => {
    const fetchMock = okFetch()
    const onPantryQuantityChanged = vi.fn()
    renderStateful([bread], onPantryQuantityChanged)

    fireEvent.click(stockPart('Bread', 'Low'))
    expect(pressedStock('Bread')).toHaveAccessibleName('Low')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/pantry/pantry-bread', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"low":true}',
    })

    fireEvent.click(stockPart('Bread', 'Have it'))
    expect(pressedStock('Bread')).toHaveAccessibleName('Have it')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/pantry/pantry-bread', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"low":false}',
    })
    // The list beside it re-reads, because a low row has a line.
    await waitFor(() => expect(onPantryQuantityChanged).toHaveBeenCalledTimes(2))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('sends low false on Have it on a low row, and keeps the row in On hand', async () => {
    const fetchMock = okFetch()
    renderStateful([bread, onion])

    fireEvent.click(stockPart('Onion', 'Have it'))

    expect(pressedStock('Onion')).toHaveAccessibleName('Have it')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-onion', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"low":false}',
    })
    expect(groupOf('Onion')).toBe('On hand 2')
  })

  it('presses Have it again and toasts on a failed Low', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    renderStateful([bread])

    fireEvent.click(stockPart('Bread', 'Low'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(pressedStock('Bread')).toHaveAccessibleName('Have it')
  })

  it('sends one low true request on Low on a row at 0, moves it to On hand and focuses Low', async () => {
    const fetchMock = okFetch()
    renderStateful([bread, avocado])
    const control = stockPart('Avocado', 'Low')
    control.focus()

    fireEvent.click(control)

    await waitFor(() => expect(groupOf('Avocado')).toBe('On hand 2'))
    expect(pressedStock('Avocado')).toHaveAccessibleName('Low')
    expect(stockPart('Avocado', 'Low')).toHaveFocus()
    await act(async () => {})
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-avocado', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"low":true}',
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('puts a row back in Ran out and toasts when Low on a row at 0 fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    renderStateful([bread, avocado])
    const control = stockPart('Avocado', 'Low')
    control.focus()

    fireEvent.click(control)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(groupOf('Avocado')).toBe('Ran out 1')
    expect(pressedStock('Avocado')).toHaveAccessibleName('Ran out')
    expect(stockPart('Avocado', 'Ran out')).toHaveFocus()
  })

  it('keeps low cleared when a failed low clear lands after the row ran out', async () => {
    let failLow: (() => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        init.body === '{"low":false}'
          ? new Promise<Response>((resolve) => {
              failLow = () => resolve(new Response(null, { status: 500 }))
            })
          : Promise.resolve(Response.json({ ok: true })),
      ),
    )
    renderStateful([bread, onion])

    fireEvent.click(stockPart('Onion', 'Have it'))
    fireEvent.click(stockPart('Onion', 'Ran out'))
    // Ran out waits in the queue behind the low clear, which fails last.
    await waitFor(() => expect(failLow).not.toBeNull())
    failLow!()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))

    fireEvent.click(stockPart('Onion', 'Have it'))
    await waitFor(() => expect(groupOf('Onion')).toBe('On hand 2'))
    expect(pressedStock('Onion')).toHaveAccessibleName('Have it')
  })

  it('keeps a Low press queued behind an amount that fails', async () => {
    const user = userEvent.setup()
    let failAmount: (() => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        init.body === '{"quantity":200}'
          ? new Promise<Response>((resolve) => {
              failAmount = () => resolve(new Response(null, { status: 500 }))
            })
          : Promise.resolve(Response.json({ ok: true })),
      ),
    )
    renderStateful([bread])

    await user.click(screen.getByRole('button', { name: 'Add amount: Bread' }))
    await user.type(screen.getByRole('textbox', { name: 'How much do you have?' }), '200')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(failAmount).not.toBeNull())
    fireEvent.click(stockPart('Bread', 'Low'))
    failAmount!()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(pressedStock('Bread')).toHaveAccessibleName('Low')
  })

  it('keeps a Low press queued behind a Ran out that fails', async () => {
    let failRanOut: (() => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        init.body === '{"quantity":0}'
          ? new Promise<Response>((resolve) => {
              failRanOut = () => resolve(new Response(null, { status: 500 }))
            })
          : Promise.resolve(Response.json({ ok: true })),
      ),
    )
    renderStateful([bread])

    fireEvent.click(stockPart('Bread', 'Ran out'))
    await waitFor(() => expect(failRanOut).not.toBeNull())
    fireEvent.click(stockPart('Bread', 'Low'))
    failRanOut!()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(pressedStock('Bread')).toHaveAccessibleName('Low')
    expect(groupOf('Bread')).toBe('On hand 1')
  })

  it('keeps an amount queued behind a Low from Ran out that fails', async () => {
    let failLow: (() => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        init.body === '{"low":true}'
          ? new Promise<Response>((resolve) => {
              failLow = () => resolve(new Response(null, { status: 500 }))
            })
          : Promise.resolve(Response.json({ ok: true })),
      ),
    )
    renderStateful([avocado])

    fireEvent.click(stockPart('Avocado', 'Low'))
    await waitFor(() => expect(failLow).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Add amount: Avocado' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'How much do you have?' }), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    failLow!()

    // The server stores quantity 3 and low false, so the row stays On hand.
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(groupOf('Avocado')).toBe('On hand 1')
    expect(pressedStock('Avocado')).toHaveAccessibleName('Have it')
    expect(screen.getByRole('button', { name: /^Amount: Avocado, 3/ })).toBeInTheDocument()
  })

  it('keeps a Low queued behind a Have it from Ran out that fails', async () => {
    let failHaveIt: (() => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        init.body === '{"quantity":null}'
          ? new Promise<Response>((resolve) => {
              failHaveIt = () => resolve(new Response(null, { status: 500 }))
            })
          : Promise.resolve(Response.json({ ok: true })),
      ),
    )
    renderStateful([avocado])

    fireEvent.click(stockPart('Avocado', 'Have it'))
    await waitFor(() => expect(failHaveIt).not.toBeNull())
    fireEvent.click(stockPart('Avocado', 'Low'))
    failHaveIt!()

    // The server applies the Low to the row at 0 as "have some" and low.
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(groupOf('Avocado')).toBe('On hand 1')
    expect(pressedStock('Avocado')).toHaveAccessibleName('Low')
  })

  it('sends quantity 0 on Ran out on a low row, and renders it in Ran out with Ran out pressed', async () => {
    const fetchMock = okFetch()
    renderStateful([bread, onion])

    fireEvent.click(stockPart('Onion', 'Ran out'))

    await waitFor(() => expect(groupOf('Onion')).toBe('Ran out 1'))
    expect(pressedStock('Onion')).toHaveAccessibleName('Ran out')
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-onion', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"quantity":0}',
    })

    // Ran out cleared low, so Have it brings the row back with Have it pressed.
    fireEvent.click(stockPart('Onion', 'Have it'))
    await waitFor(() => expect(groupOf('Onion')).toBe('On hand 2'))
    expect(pressedStock('Onion')).toHaveAccessibleName('Have it')
  })

  it('is reached by Tab, moves with the arrow keys, presses with Space and Enter, and keeps focus after the response', async () => {
    const user = userEvent.setup()
    const fetchMock = okFetch()
    renderStateful([salt])

    // The first line (star, Remove), then the stock control under the name, in
    // reading order: Tab from Remove lands on the pressed part.
    screen.getByRole('button', { name: 'Remove Salt' }).focus()
    await user.tab()
    expect(stockPart('Salt', 'Have it')).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(stockPart('Salt', 'Low')).toHaveFocus()
    // An arrow moves focus only; it sends nothing.
    expect(fetchMock).not.toHaveBeenCalled()

    await user.keyboard(' ')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(pressedStock('Salt')).toHaveAccessibleName('Low')
    expect(stockPart('Salt', 'Low')).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(stockPart('Salt', 'Have it')).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(pressedStock('Salt')).toHaveAccessibleName('Have it')
    expect(stockPart('Salt', 'Have it')).toHaveFocus()
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/pantry/pantry-salt',
      expect.objectContaining({ body: '{"low":true}' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/pantry/pantry-salt',
      expect.objectContaining({ body: '{"low":false}' }),
    )
  })
})

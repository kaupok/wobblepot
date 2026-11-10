import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  chooseRowAction,
  groupOf,
  makeItem,
  moreActions,
  pressedStock,
  renderSection,
  renderStateful,
  rowActions,
  rowOf,
  stockPart,
} from './PantrySection.fixtures'

// `toast` is callable (the Undo toast) and carries `error` / `success`.
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

// An On hand row takes an amount (HON-1402): the shopping list subtracts it,
// and completing a meal takes its ingredients off it.
describe('PantrySection amount', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const trout = makeItem({
    id: 'pantry-trout',
    ingredient: { id: 'ing-trout', name: 'Trout', category: 'protein', defaultUnit: 'g' },
    quantity: null,
  })
  const salt = makeItem({
    id: 'pantry-salt',
    ingredient: { id: 'ing-salt', name: 'Salt', category: 'spice', defaultUnit: 'g' },
    isStaple: true,
  })

  function okFetch() {
    // A new response per call, because a body reads once.
    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function patchBody(quantity: number | null) {
    return {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity }),
    }
  }

  /** Opens the field from ⋯, as "Add amount" or "Change amount". */
  async function openAmount(name: string) {
    await chooseRowAction(name, /^(Add|Change) amount$/)
  }

  async function enterAmount(name: string, text: string) {
    await openAmount(name)
    fireEvent.change(screen.getByRole('textbox', { name: 'How much do you have?' }), {
      target: { value: text },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('offers "Add amount" and Remove in ⋯ on a row at null, and no buttons for them on the row', async () => {
    renderSection([trout])

    expect(screen.queryByRole('button', { name: /Add amount/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Trout' })).not.toBeInTheDocument()
    expect(rowOf('Trout')).toHaveTextContent(/^Trout50g needed in next 7 days/)
    expect(await rowActions('Trout')).toEqual(['Add amount', 'Remove'])
  })

  it('saves 1800 and starts the meta line with "1800 g", then focuses ⋯', async () => {
    const fetchMock = okFetch()
    const onPantryQuantityChanged = vi.fn()
    renderStateful([trout], onPantryQuantityChanged)

    await enterAmount('Trout', '1800')

    await waitFor(() =>
      expect(rowOf('Trout')).toHaveTextContent('1800 g · 50g needed in next 7 days'),
    )
    expect(moreActions('Trout')).toHaveFocus()
    expect(await rowActions('Trout')).toEqual(['Change amount', 'Remove'])
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-trout', patchBody(1800))
    // The shopping list beside it re-reads, so the line shrinks or goes.
    await waitFor(() => expect(onPantryQuantityChanged).toHaveBeenCalledTimes(1))
    expect(groupOf('Trout')).toBe('On hand 1')
  })

  it('shows the amount in the unit the pantry shows', () => {
    renderSection([
      makeItem({
        ingredient: {
          id: 'ing-milk',
          name: 'Milk',
          category: 'dairy',
          defaultUnit: 'g',
          displayUnit: 'ml',
        },
        quantity: 750,
      }),
      makeItem({
        id: 'pantry-eggs',
        ingredient: { id: 'ing-eggs', name: 'Eggs', category: 'protein', defaultUnit: 'piece' },
        quantity: 6,
      }),
    ])

    expect(rowOf('Milk')).toHaveTextContent('750 ml · 50g needed')
    expect(rowOf('Eggs')).toHaveTextContent('6 pc · 50g needed')
  })

  it('opens the field from Change amount and saves an empty field as null', async () => {
    const fetchMock = okFetch()
    renderStateful([{ ...trout, quantity: 1800 }])

    await chooseRowAction('Trout', 'Change amount')
    const field = screen.getByRole('textbox', { name: 'How much do you have?' })
    expect(field).toHaveValue('1800')
    expect(field).toHaveFocus()
    expect(field).toHaveAttribute('inputmode', 'decimal')
    enterAmountInOpenField('')

    await waitFor(() => expect(rowOf('Trout')).not.toHaveTextContent('1800'))
    expect(moreActions('Trout')).toHaveFocus()
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-trout', patchBody(null))
  })

  function enterAmountInOpenField(text: string) {
    fireEvent.change(screen.getByRole('textbox', { name: 'How much do you have?' }), {
      target: { value: text },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('saves 0 as ran out, moves the row and focuses its Ran out part', async () => {
    const fetchMock = okFetch()
    renderStateful([trout, makeItem({ quantity: 2 })])

    await enterAmount('Trout', '0')

    await waitFor(() => expect(groupOf('Trout')).toBe('Ran out 1'))
    expect(pressedStock('Trout')).toHaveAccessibleName('Ran out')
    expect(stockPart('Trout', 'Ran out')).toHaveFocus()
    expect(document.body).not.toHaveFocus()
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-trout', patchBody(0))
  })

  it('brings the amount back when Have it follows a 0', async () => {
    const fetchMock = okFetch()
    renderStateful([{ ...trout, quantity: 1800 }])

    await enterAmount('Trout', '0')
    await waitFor(() => expect(groupOf('Trout')).toBe('Ran out 1'))
    fireEvent.click(stockPart('Trout', 'Have it'))

    await waitFor(() => expect(rowOf('Trout')).toHaveTextContent('1800 g · '))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(toast.error).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/pantry/pantry-trout', patchBody(1800))
  })

  it('saves "1,8" as 1.8', async () => {
    const fetchMock = okFetch()
    renderStateful([trout])

    await enterAmount('Trout', '1,8')

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-trout', patchBody(1.8)),
    )
    expect(rowOf('Trout')).toHaveTextContent('1.8 g · ')
  })

  it.each(['-1', 'abc'])('refuses "%s" with the field error and writes nothing', async (text) => {
    const fetchMock = okFetch()
    renderStateful([trout])

    await enterAmount('Trout', text)

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number')
    const field = screen.getByRole('textbox', { name: 'How much do you have?' })
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription(/Enter a number/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('focuses the field when Add amount opens it, not ⋯', async () => {
    okFetch()
    renderStateful([trout])

    await chooseRowAction('Trout', 'Add amount')

    expect(screen.getByRole('textbox', { name: 'How much do you have?' })).toHaveFocus()
  })

  it('cancels without a write and focuses ⋯', async () => {
    const fetchMock = okFetch()
    renderStateful([trout])

    await openAmount('Trout')
    fireEvent.change(screen.getByRole('textbox', { name: 'How much do you have?' }), {
      target: { value: '500' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('textbox', { name: 'How much do you have?' })).not.toBeInTheDocument()
    expect(moreActions('Trout')).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels on Escape too', async () => {
    okFetch()
    renderStateful([trout])

    await openAmount('Trout')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'How much do you have?' }), {
      key: 'Escape',
    })

    expect(moreActions('Trout')).toHaveFocus()
  })

  it('offers only Remove in ⋯ on a staple row and a ran-out row', async () => {
    renderSection([salt, { ...trout, quantity: 0 }])

    expect(await rowActions('Salt')).toEqual(['Remove'])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(await rowActions('Trout')).toEqual(['Remove'])
  })

  it('puts the row back and toasts on a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    const onPantryQuantityChanged = vi.fn()
    renderStateful([trout], onPantryQuantityChanged)

    await enterAmount('Trout', '1800')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(rowOf('Trout')).not.toHaveTextContent('1800')
    expect(onPantryQuantityChanged).not.toHaveBeenCalled()
  })

  it('follows the row back to its ⋯ when a failed 0 returns it to On hand', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    renderStateful([{ ...trout, quantity: 1800 }])

    await enterAmount('Trout', '0')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(groupOf('Trout')).toBe('On hand 1')
    expect(rowOf('Trout')).toHaveTextContent('1800 g · ')
    expect(moreActions('Trout')).toHaveFocus()
  })

  it('keeps focus on the stock control when a failed amount above 0 leaves the row in place', async () => {
    let fail: (response: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise<Response>((resolve) => (fail = resolve))),
    )
    renderStateful([trout])

    await enterAmount('Trout', '1800')
    const control = stockPart('Trout', 'Have it')
    control.focus()
    await act(async () => fail(new Response(null, { status: 500 })))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(control).toHaveFocus()
  })
})

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { groupOf, makeItem, renderSection, renderStateful } from './PantrySection.fixtures'

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

  function enterAmount(name: string, text: string) {
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`^(Add amount|Amount): ${name}`) }),
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'How much do you have?' }), {
      target: { value: text },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('reads "Add amount" on a row at null', () => {
    renderSection([trout])

    expect(screen.getByRole('button', { name: 'Add amount: Trout' })).toHaveTextContent(
      'Add amount',
    )
  })

  it('saves 1800 and shows "1800 g", then focuses the amount', async () => {
    const fetchMock = okFetch()
    const onPantryQuantityChanged = vi.fn()
    renderStateful([trout], onPantryQuantityChanged)

    enterAmount('Trout', '1800')

    const amount = await screen.findByRole('button', { name: 'Amount: Trout, 1800\u00a0g' })
    expect(amount).toHaveTextContent('1800 g')
    expect(amount).toHaveFocus()
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

    expect(screen.getByRole('button', { name: 'Amount: Milk, 750\u00a0ml' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Amount: Eggs, 6\u00a0pc' })).toBeInTheDocument()
  })

  it('opens the field on the amount and saves an empty field as null', async () => {
    const fetchMock = okFetch()
    renderStateful([{ ...trout, quantity: 1800 }])

    fireEvent.click(screen.getByRole('button', { name: 'Amount: Trout, 1800\u00a0g' }))
    const field = screen.getByRole('textbox', { name: 'How much do you have?' })
    expect(field).toHaveValue('1800')
    expect(field).toHaveFocus()
    expect(field).toHaveAttribute('inputmode', 'decimal')
    enterAmountInOpenField('')

    const addAmount = await screen.findByRole('button', { name: 'Add amount: Trout' })
    expect(addAmount).toHaveFocus()
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-trout', patchBody(null))
  })

  function enterAmountInOpenField(text: string) {
    fireEvent.change(screen.getByRole('textbox', { name: 'How much do you have?' }), {
      target: { value: text },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('saves 0 as ran out, moves the row and focuses its switch', async () => {
    const fetchMock = okFetch()
    renderStateful([trout, makeItem({ quantity: 2 })])

    enterAmount('Trout', '0')

    await waitFor(() => expect(groupOf('Trout')).toBe('Ran out 1'))
    expect(screen.getByRole('switch', { name: 'Have it: Trout' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Have it: Trout' })).toHaveFocus()
    expect(document.body).not.toHaveFocus()
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-trout', patchBody(0))
  })

  it('brings the amount back when switch-on follows a 0', async () => {
    const fetchMock = okFetch()
    renderStateful([{ ...trout, quantity: 1800 }])

    enterAmount('Trout', '0')
    fireEvent.click(await screen.findByRole('switch', { name: 'Have it: Trout' }))

    expect(
      await screen.findByRole('button', { name: 'Amount: Trout, 1800\u00a0g' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(toast.error).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/pantry/pantry-trout', patchBody(1800))
  })

  it('saves "1,8" as 1.8', async () => {
    const fetchMock = okFetch()
    renderStateful([trout])

    enterAmount('Trout', '1,8')

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-trout', patchBody(1.8)),
    )
    expect(screen.getByRole('button', { name: 'Amount: Trout, 1.8\u00a0g' })).toBeInTheDocument()
  })

  it.each(['-1', 'abc'])('refuses "%s" with the field error and writes nothing', (text) => {
    const fetchMock = okFetch()
    renderStateful([trout])

    enterAmount('Trout', text)

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number')
    const field = screen.getByRole('textbox', { name: 'How much do you have?' })
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription(/Enter a number/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels without a write and focuses the amount control', () => {
    const fetchMock = okFetch()
    renderStateful([trout])

    fireEvent.click(screen.getByRole('button', { name: 'Add amount: Trout' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'How much do you have?' }), {
      target: { value: '500' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('textbox', { name: 'How much do you have?' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add amount: Trout' })).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels on Escape too', () => {
    okFetch()
    renderStateful([trout])

    fireEvent.click(screen.getByRole('button', { name: 'Add amount: Trout' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'How much do you have?' }), {
      key: 'Escape',
    })

    expect(screen.getByRole('button', { name: 'Add amount: Trout' })).toHaveFocus()
  })

  it('gives a staple and a ran-out row no amount control', () => {
    renderSection([salt, { ...trout, quantity: 0 }])

    expect(screen.queryByRole('button', { name: /^(Add amount|Amount):/ })).not.toBeInTheDocument()
    const stapleRow = screen.getByText('Salt').closest('.p-3') as HTMLElement
    expect(within(stapleRow).queryByText('Add amount')).not.toBeInTheDocument()
  })

  it('puts the row back and toasts on a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    const onPantryQuantityChanged = vi.fn()
    renderStateful([trout], onPantryQuantityChanged)

    enterAmount('Trout', '1800')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(screen.getByRole('button', { name: 'Add amount: Trout' })).toBeInTheDocument()
    expect(onPantryQuantityChanged).not.toHaveBeenCalled()
  })

  it('follows the row back to its amount when a failed 0 returns it to On hand', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    renderStateful([{ ...trout, quantity: 1800 }])

    enterAmount('Trout', '0')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(groupOf('Trout')).toBe('On hand 1')
    expect(screen.getByRole('button', { name: 'Amount: Trout, 1800\u00a0g' })).toHaveFocus()
  })
})

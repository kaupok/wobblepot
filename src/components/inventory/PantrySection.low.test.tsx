import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { groupOf, makeItem, renderSection, renderStateful } from './PantrySection.fixtures'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

// A row whose switch is on carries a Running low toggle (HON-1587); ran out
// replaces low, so a row at 0 has none (HON-1586).
describe('PantrySection running low', () => {
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
  const lowToggle = (name: string) => screen.getByRole('button', { name: `Running low: ${name}` })

  it('renders the toggle unpressed on a null row, pressed on a low row, on a staple, and not on a ran-out row', () => {
    renderSection([eggs, salt, bread, onion, avocado])

    expect(lowToggle('Bread')).toHaveAttribute('aria-pressed', 'false')
    expect(lowToggle('Onion')).toHaveAttribute('aria-pressed', 'true')
    expect(lowToggle('Salt')).toHaveAttribute('aria-pressed', 'false')
    expect(lowToggle('Bread')).toHaveTextContent('Running low')
    expect(screen.queryByRole('button', { name: 'Running low: Avocado' })).not.toBeInTheDocument()
    // A staple at 0 stays under Staples, and ran out replaces low there too.
    expect(screen.queryByRole('button', { name: 'Running low: Eggs' })).not.toBeInTheDocument()
    // A low row stays in its group.
    expect(groupOf('Onion')).toBe('On hand 2')
  })

  it('sends low true on a tap and low false on a second tap', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const onPantryQuantityChanged = vi.fn()
    renderStateful([bread], onPantryQuantityChanged)

    fireEvent.click(lowToggle('Bread'))
    expect(lowToggle('Bread')).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/pantry/pantry-bread', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"low":true}',
    })

    fireEvent.click(lowToggle('Bread'))
    expect(lowToggle('Bread')).toHaveAttribute('aria-pressed', 'false')
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

  it('unpresses the toggle and toasts on a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    renderStateful([bread])

    fireEvent.click(lowToggle('Bread'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(lowToggle('Bread')).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps low cleared when a failed low clear lands after the row was switched off', async () => {
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

    fireEvent.click(lowToggle('Onion'))
    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Onion' }))
    // The switch-off waits in the queue behind the low clear, which fails last.
    await waitFor(() => expect(failLow).not.toBeNull())
    failLow!()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))

    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Onion' }))
    await waitFor(() => expect(groupOf('Onion')).toBe('On hand 2'))
    expect(lowToggle('Onion')).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps a Running low tap queued behind an amount that fails', async () => {
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
    fireEvent.click(lowToggle('Bread'))
    failAmount!()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(lowToggle('Bread')).toHaveAttribute('aria-pressed', 'true')
  })

  it('sends quantity 0 when a low row is switched off, and renders it in Ran out with no toggle', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    renderStateful([bread, onion])

    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Onion' }))

    await waitFor(() => expect(groupOf('Onion')).toBe('Ran out 1'))
    expect(screen.queryByRole('button', { name: 'Running low: Onion' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/pantry/pantry-onion', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"quantity":0}',
    })

    // Ran out cleared low, so switching it back on shows the toggle unpressed.
    fireEvent.click(screen.getByRole('switch', { name: 'Have it: Onion' }))
    await waitFor(() => expect(groupOf('Onion')).toBe('On hand 2'))
    expect(lowToggle('Onion')).toHaveAttribute('aria-pressed', 'false')
  })

  it('is reached by Tab, flips with Space and Enter, and keeps focus after the response', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    renderStateful([salt])

    // The star, then the toggle under the name, then the switch.
    screen.getByRole('button', { name: 'Remove from staples' }).focus()
    await user.tab()
    expect(lowToggle('Salt')).toHaveFocus()

    await user.keyboard(' ')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(lowToggle('Salt')).toHaveAttribute('aria-pressed', 'true')
    expect(lowToggle('Salt')).toHaveFocus()

    await user.keyboard('{Enter}')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(lowToggle('Salt')).toHaveAttribute('aria-pressed', 'false')
    expect(lowToggle('Salt')).toHaveFocus()
  })
})

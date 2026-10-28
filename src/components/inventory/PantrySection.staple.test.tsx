import { afterEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { makeItem, renderStateful } from './PantrySection.fixtures'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

// The list skips a staple unless it ran out (HON-1398), and an ordinary row at
// 0 or below the need has a line (`pantry-shopping-lines.ts`). So the star on
// a row with an amount adds or removes a line, and re-reads the list
// (HON-1439). A "have some" row (null) has no line either way.
describe('PantrySection star re-reads the shopping list', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  function stubPatch() {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ success: true })))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('re-reads the list once the star lands on a row at 0', async () => {
    const fetchMock = stubPatch()
    const refresh = vi.fn()
    renderStateful([makeItem({ quantity: 0 })], refresh)

    fireEvent.click(screen.getByRole('button', { name: 'Mark as staple' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pantry/pantry-1',
      expect.objectContaining({ method: 'PATCH', body: '{"isStaple":true}' }),
    )
  })

  it('re-reads the list once the unstar lands on a staple at 0', async () => {
    stubPatch()
    const refresh = vi.fn()
    renderStateful([makeItem({ quantity: 0, isStaple: true })], refresh)

    fireEvent.click(screen.getByRole('button', { name: 'Remove from staples' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('re-reads the list once the star lands on a row with an amount', async () => {
    stubPatch()
    const refresh = vi.fn()
    renderStateful([makeItem({ quantity: 20 })], refresh)

    fireEvent.click(screen.getByRole('button', { name: 'Mark as staple' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('does not re-read the list for a "have some" row', async () => {
    const fetchMock = stubPatch()
    const refresh = vi.fn()
    renderStateful([makeItem({ quantity: null })], refresh)

    fireEvent.click(screen.getByRole('button', { name: 'Mark as staple' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    // The row turned into a staple, so the request has settled.
    await screen.findByRole('button', { name: 'Remove from staples' })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not re-read the list when the star fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ error: 'nope' }, { status: 500 }))),
    )
    const refresh = vi.fn()
    renderStateful([makeItem({ quantity: 0 })], refresh)

    fireEvent.click(screen.getByRole('button', { name: 'Mark as staple' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    // The star rolls back on the failure.
    expect(screen.getByRole('button', { name: 'Mark as staple' })).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})

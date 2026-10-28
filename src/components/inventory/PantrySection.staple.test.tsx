import { afterEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { makeItem, renderStateful } from './PantrySection.fixtures'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

// A staple at 0 is on the shopping list and an ordinary row at 0 is not
// (HON-1398), so the star at 0 adds or removes a restock line. The list is
// the server's, so the star re-reads it (HON-1439).
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

  it('does not re-read the list for a row above 0', async () => {
    const fetchMock = stubPatch()
    const refresh = vi.fn()
    renderStateful([makeItem({ quantity: 2 })], refresh)

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

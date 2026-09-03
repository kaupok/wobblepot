import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { CustomItemData } from '@/components/shopping/CustomItemInput'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { toast } from 'sonner'
import { useCustomShoppingItems } from './use-custom-shopping-items'

function customItem(name: string, overrides: Partial<CustomItemData> = {}): CustomItemData {
  return {
    id: `custom-${name.toLowerCase()}`,
    name,
    checked: false,
    ingredientId: null,
    ingredientCategory: null,
    createdAt: '2026-02-16T00:00:00.000Z',
    ...overrides,
  }
}

const ok = { ok: true, json: async () => ({}) }
const failure = { ok: false, json: async () => ({}) }

describe('useCustomShoppingItems', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockResolvedValue(ok)
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('seeds from the initial items and counts checked / unchecked', () => {
    const { result } = renderHook(() =>
      useCustomShoppingItems([customItem('Bread', { checked: true }), customItem('Napkins')]),
    )

    expect(result.current.customItems).toHaveLength(2)
    expect(result.current.checkedCustomCount).toBe(1)
    expect(result.current.uncheckedCustomCount).toBe(1)
  })

  it('prepends a newly added item', () => {
    const { result } = renderHook(() => useCustomShoppingItems([customItem('Bread')]))

    act(() => result.current.handleCustomItemAdded(customItem('Napkins')))

    expect(result.current.customItems.map((i) => i.name)).toEqual(['Napkins', 'Bread'])
  })

  describe('toggle', () => {
    it('checks the item optimistically and PATCHes it', async () => {
      const { result } = renderHook(() => useCustomShoppingItems([customItem('Bread')]))

      await act(async () => {
        await result.current.handleCustomToggle('custom-bread', true)
      })

      expect(result.current.customItems[0]?.checked).toBe(true)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe('/api/shopping-list/custom/custom-bread')
      expect(init.method).toBe('PATCH')
      expect(JSON.parse(init.body)).toEqual({ checked: true })
    })

    it('reverts and surfaces an error when the request fails', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Nope' }),
      })
      const { result } = renderHook(() => useCustomShoppingItems([customItem('Bread')]))

      await act(async () => {
        await result.current.handleCustomToggle('custom-bread', true)
      })

      expect(result.current.customItems[0]?.checked).toBe(false)
      expect(toast.error).toHaveBeenCalledWith('Nope')
    })

    it('clears the pending id once the request settles', async () => {
      const { result } = renderHook(() => useCustomShoppingItems([customItem('Bread')]))

      await act(async () => {
        await result.current.handleCustomToggle('custom-bread', true)
      })

      await waitFor(() => expect(result.current.pendingCustomIds.size).toBe(0))
    })
  })

  describe('unlink', () => {
    it('clears the ingredient link optimistically', async () => {
      const { result } = renderHook(() =>
        useCustomShoppingItems([
          customItem('Kale', { ingredientId: 'ing-kale', ingredientCategory: 'vegetable' }),
        ]),
      )

      await act(async () => {
        await result.current.handleCustomUnlink('custom-kale')
      })

      expect(result.current.customItems[0]).toMatchObject({
        ingredientId: null,
        ingredientCategory: null,
      })
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ ingredientId: null })
    })

    it('restores the ingredient link and toasts when the request fails', async () => {
      fetchMock.mockResolvedValueOnce(failure)
      const { result } = renderHook(() =>
        useCustomShoppingItems([
          customItem('Kale', { ingredientId: 'ing-kale', ingredientCategory: 'vegetable' }),
        ]),
      )

      await act(async () => {
        await result.current.handleCustomUnlink('custom-kale')
      })

      // Still linked, so splitCustomItems keeps the row in its CategoryGroup.
      expect(result.current.customItems[0]).toMatchObject({
        ingredientId: 'ing-kale',
        ingredientCategory: 'vegetable',
      })
      expect(toast.error).toHaveBeenCalled()
    })

    it('keeps a check applied while the failing request was in flight', async () => {
      fetchMock.mockResolvedValueOnce(failure)
      const { result } = renderHook(() =>
        useCustomShoppingItems([
          customItem('Kale', { ingredientId: 'ing-kale', ingredientCategory: 'vegetable' }),
        ]),
      )

      await act(async () => {
        const unlink = result.current.handleCustomUnlink('custom-kale')
        await result.current.handleCustomToggle('custom-kale', true)
        await unlink
      })

      expect(result.current.customItems[0]).toMatchObject({
        ingredientId: 'ing-kale',
        ingredientCategory: 'vegetable',
        checked: true,
      })
    })
  })

  describe('delete', () => {
    it('removes the item and DELETEs it', async () => {
      const { result } = renderHook(() =>
        useCustomShoppingItems([customItem('Bread'), customItem('Napkins')]),
      )

      await act(async () => {
        await result.current.handleCustomDelete('custom-bread')
      })

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Napkins'])
      expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE')
    })

    it('restores the removed item at its original index when the request fails', async () => {
      fetchMock.mockResolvedValueOnce(failure)
      const { result } = renderHook(() =>
        useCustomShoppingItems([customItem('Bread'), customItem('Napkins'), customItem('Milk')]),
      )

      await act(async () => {
        await result.current.handleCustomDelete('custom-napkins')
      })

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Bread', 'Napkins', 'Milk'])
      expect(toast.error).toHaveBeenCalled()
    })

    it('keeps the row gone when the request 404s — it is already deleted', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
      const { result } = renderHook(() =>
        useCustomShoppingItems([customItem('Bread'), customItem('Napkins')]),
      )

      await act(async () => {
        await result.current.handleCustomDelete('custom-bread')
      })

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Napkins'])
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('does not duplicate the row when two failing deletes overlap', async () => {
      fetchMock.mockResolvedValue(failure)
      const { result } = renderHook(() =>
        useCustomShoppingItems([customItem('Bread'), customItem('Napkins')]),
      )

      await act(async () => {
        await Promise.all([
          result.current.handleCustomDelete('custom-bread'),
          result.current.handleCustomDelete('custom-bread'),
        ])
      })

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Bread', 'Napkins'])
    })
  })

  describe('clear checked', () => {
    it('drops every checked item in one request', async () => {
      const { result } = renderHook(() =>
        useCustomShoppingItems([
          customItem('Bread', { checked: true }),
          customItem('Napkins'),
          customItem('Milk', { checked: true }),
        ]),
      )

      await act(async () => {
        await result.current.handleClearChecked()
      })

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Napkins'])
      expect(fetchMock).toHaveBeenCalledWith('/api/shopping-list/custom/checked', {
        method: 'DELETE',
      })
    })

    it('restores every checked item, in order, when the request fails', async () => {
      fetchMock.mockResolvedValueOnce(failure)
      const { result } = renderHook(() =>
        useCustomShoppingItems([
          customItem('Bread', { checked: true }),
          customItem('Napkins'),
          customItem('Milk', { checked: true }),
        ]),
      )

      await act(async () => {
        await result.current.handleClearChecked()
      })

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Bread', 'Napkins', 'Milk'])
      expect(result.current.checkedCustomCount).toBe(2)
      expect(toast.error).toHaveBeenCalled()
    })

    it('keeps an item added while the failing request was in flight', async () => {
      fetchMock.mockResolvedValueOnce(failure)
      const { result } = renderHook(() =>
        useCustomShoppingItems([customItem('Bread', { checked: true }), customItem('Napkins')]),
      )

      await act(async () => {
        const clear = result.current.handleClearChecked()
        result.current.handleCustomItemAdded(customItem('Eggs'))
        await clear
      })

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Eggs', 'Bread', 'Napkins'])
    })

    it('does not resurrect a row a concurrent delete removed successfully', async () => {
      // clear-checked fails; the overlapping delete of the unchecked row wins.
      fetchMock.mockImplementation((url: string) =>
        Promise.resolve(url.endsWith('/checked') ? failure : ok),
      )
      const { result } = renderHook(() =>
        useCustomShoppingItems([customItem('Bread', { checked: true }), customItem('Napkins')]),
      )

      await act(async () => {
        const clear = result.current.handleClearChecked()
        const remove = result.current.handleCustomDelete('custom-napkins')
        await Promise.all([clear, remove])
      })

      // Bread was ours to restore; Napkins is gone from the DB and must stay gone.
      expect(result.current.customItems.map((i) => i.name)).toEqual(['Bread'])
    })

    it('does nothing when nothing is checked', async () => {
      const { result } = renderHook(() => useCustomShoppingItems([customItem('Bread')]))

      await act(async () => {
        await result.current.handleClearChecked()
      })

      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import type { CustomItemData } from '@/components/shopping/CustomItemInput'
import { createQueryWrapper } from '@/test/query-wrapper'

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

let queryClient: QueryClient

function renderItemsHook(initialItems: CustomItemData[]) {
  const query = createQueryWrapper()
  queryClient = query.queryClient
  return renderHook(() => useCustomShoppingItems(initialItems), { wrapper: query.wrapper })
}

/** The handlers fire mutations and return; wait for every one to settle. */
function settle() {
  return waitFor(() => expect(queryClient.isMutating()).toBe(0))
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
    const { result } = renderItemsHook([
      customItem('Bread', { checked: true }),
      customItem('Napkins'),
    ])

    expect(result.current.customItems).toHaveLength(2)
    expect(result.current.checkedCustomCount).toBe(1)
    expect(result.current.uncheckedCustomCount).toBe(1)
  })

  it('prepends a newly added item', () => {
    const { result } = renderItemsHook([customItem('Bread')])

    act(() => result.current.handleCustomItemAdded(customItem('Napkins')))

    expect(result.current.customItems.map((i) => i.name)).toEqual(['Napkins', 'Bread'])
  })

  describe('toggle', () => {
    it('checks the item optimistically and PATCHes it', async () => {
      const { result } = renderItemsHook([customItem('Bread')])

      act(() => {
        result.current.handleCustomToggle('custom-bread', true)
      })
      await settle()

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
      const { result } = renderItemsHook([customItem('Bread')])

      act(() => {
        result.current.handleCustomToggle('custom-bread', true)
      })
      await settle()

      expect(result.current.customItems[0]?.checked).toBe(false)
      expect(toast.error).toHaveBeenCalledWith('Nope')
    })

    it('clears the pending id once the request settles', async () => {
      const { result } = renderItemsHook([customItem('Bread')])

      act(() => {
        result.current.handleCustomToggle('custom-bread', true)
      })
      await settle()

      await waitFor(() => expect(result.current.pendingCustomIds.size).toBe(0))
    })
  })

  describe('unlink', () => {
    it('clears the ingredient link optimistically', async () => {
      const { result } = renderItemsHook([
        customItem('Kale', { ingredientId: 'ing-kale', ingredientCategory: 'vegetable' }),
      ])

      act(() => {
        result.current.handleCustomUnlink('custom-kale')
      })
      await settle()

      expect(result.current.customItems[0]).toMatchObject({
        ingredientId: null,
        ingredientCategory: null,
      })
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ ingredientId: null })
    })

    it('restores the ingredient link and toasts when the request fails', async () => {
      fetchMock.mockResolvedValueOnce(failure)
      const { result } = renderItemsHook([
        customItem('Kale', { ingredientId: 'ing-kale', ingredientCategory: 'vegetable' }),
      ])

      act(() => {
        result.current.handleCustomUnlink('custom-kale')
      })
      await settle()

      // Still linked, so splitCustomItems keeps the row in its CategoryGroup.
      expect(result.current.customItems[0]).toMatchObject({
        ingredientId: 'ing-kale',
        ingredientCategory: 'vegetable',
      })
      expect(toast.error).toHaveBeenCalled()
    })

    it('drops a second unlink while the first is in flight, and still restores', async () => {
      // A real double-click: React re-renders between the two, so without the
      // pending guard the second call would snapshot the first one's optimistic
      // `null` and restore that over the real link.
      const release: Array<() => void> = []
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            release.push(() => resolve(failure))
          }),
      )

      const { result } = renderItemsHook([
        customItem('Kale', { ingredientId: 'ing-kale', ingredientCategory: 'vegetable' }),
      ])

      act(() => {
        result.current.handleCustomUnlink('custom-kale')
      })

      expect(result.current.customItems[0]?.ingredientId).toBeNull()
      await waitFor(() => expect(result.current.pendingCustomIds.has('custom-kale')).toBe(true))

      act(() => {
        result.current.handleCustomUnlink('custom-kale')
      })

      // The guard dropped it: no second PATCH was ever sent.
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await waitFor(() => expect(release).toHaveLength(1))
      act(() => release[0]!())
      await settle()

      expect(result.current.customItems[0]).toMatchObject({
        ingredientId: 'ing-kale',
        ingredientCategory: 'vegetable',
      })
    })

    it('keeps a check applied while the failing request was in flight', async () => {
      fetchMock.mockResolvedValueOnce(failure)
      const { result } = renderItemsHook([
        customItem('Kale', { ingredientId: 'ing-kale', ingredientCategory: 'vegetable' }),
      ])

      act(() => {
        result.current.handleCustomUnlink('custom-kale')
        result.current.handleCustomToggle('custom-kale', true)
      })
      await settle()

      expect(result.current.customItems[0]).toMatchObject({
        ingredientId: 'ing-kale',
        ingredientCategory: 'vegetable',
        checked: true,
      })
    })
  })

  describe('delete', () => {
    it('removes the item and DELETEs it', async () => {
      const { result } = renderItemsHook([customItem('Bread'), customItem('Napkins')])

      act(() => {
        result.current.handleCustomDelete('custom-bread')
      })
      await settle()

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Napkins'])
      expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE')
    })

    it('restores the removed item at its original index when the request fails', async () => {
      fetchMock.mockResolvedValueOnce(failure)
      const { result } = renderItemsHook([
        customItem('Bread'),
        customItem('Napkins'),
        customItem('Milk'),
      ])

      act(() => {
        result.current.handleCustomDelete('custom-napkins')
      })
      await settle()

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Bread', 'Napkins', 'Milk'])
      expect(toast.error).toHaveBeenCalled()
    })

    it('keeps the row gone on a 404 that means the row is already deleted', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Item not found' }),
      })
      const { result } = renderItemsHook([customItem('Bread'), customItem('Napkins')])

      act(() => {
        result.current.handleCustomDelete('custom-bread')
      })
      await settle()

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Napkins'])
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('restores the row on a 404 that means the household is missing', async () => {
      // Same status, opposite meaning: the row is still on the server.
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'No household found' }),
      })
      const { result } = renderItemsHook([customItem('Bread'), customItem('Napkins')])

      act(() => {
        result.current.handleCustomDelete('custom-bread')
      })
      await settle()

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Bread', 'Napkins'])
      expect(toast.error).toHaveBeenCalled()
    })

    it('does not duplicate the row when two failing deletes overlap', async () => {
      fetchMock.mockResolvedValue(failure)
      const { result } = renderItemsHook([customItem('Bread'), customItem('Napkins')])

      act(() => {
        result.current.handleCustomDelete('custom-bread')
        result.current.handleCustomDelete('custom-bread')
      })
      await settle()

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Bread', 'Napkins'])
    })

    it('restores after an item added mid-flight, keeping both positions', async () => {
      // The captured index is stale once a prepend shifts the list, so the
      // rollback anchors on the row the deleted one used to follow.
      let releaseDelete: () => void = () => {}
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseDelete = () => resolve(failure)
          }),
      )
      const { result } = renderItemsHook([
        customItem('Bread'),
        customItem('Napkins'),
        customItem('Milk'),
      ])

      act(() => {
        result.current.handleCustomDelete('custom-napkins')
      })

      act(() => result.current.handleCustomItemAdded(customItem('Eggs')))

      // The request goes out a few microtasks after the call; release it only then.
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      act(() => releaseDelete())
      await settle()

      expect(result.current.customItems.map((i) => i.name)).toEqual([
        'Eggs',
        'Bread',
        'Napkins',
        'Milk',
      ])
    })
  })

  describe('clear checked', () => {
    it('drops every checked item in one request', async () => {
      const { result } = renderItemsHook([
        customItem('Bread', { checked: true }),
        customItem('Napkins'),
        customItem('Milk', { checked: true }),
      ])

      act(() => {
        result.current.handleClearChecked()
      })
      await settle()

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Napkins'])
      expect(fetchMock).toHaveBeenCalledWith('/api/shopping-list/custom/checked', {
        method: 'DELETE',
      })
    })

    it('restores every checked item, in order, when the request fails', async () => {
      fetchMock.mockResolvedValueOnce(failure)
      const { result } = renderItemsHook([
        customItem('Bread', { checked: true }),
        customItem('Napkins'),
        customItem('Milk', { checked: true }),
      ])

      act(() => {
        result.current.handleClearChecked()
      })
      await settle()

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Bread', 'Napkins', 'Milk'])
      expect(result.current.checkedCustomCount).toBe(2)
      expect(toast.error).toHaveBeenCalled()
    })

    it('keeps an item added while the failing request was in flight', async () => {
      fetchMock.mockResolvedValueOnce(failure)
      const { result } = renderItemsHook([
        customItem('Bread', { checked: true }),
        customItem('Napkins'),
      ])

      act(() => {
        result.current.handleClearChecked()
        result.current.handleCustomItemAdded(customItem('Eggs'))
      })
      await settle()

      expect(result.current.customItems.map((i) => i.name)).toEqual(['Eggs', 'Bread', 'Napkins'])
    })

    it('does not resurrect a row a concurrent delete removed successfully', async () => {
      // clear-checked fails; the overlapping delete of the unchecked row wins.
      fetchMock.mockImplementation((url: string) =>
        Promise.resolve(url.endsWith('/checked') ? failure : ok),
      )
      const { result } = renderItemsHook([
        customItem('Bread', { checked: true }),
        customItem('Napkins'),
      ])

      act(() => {
        result.current.handleClearChecked()
        result.current.handleCustomDelete('custom-napkins')
      })
      await settle()

      // Bread was ours to restore; Napkins is gone from the DB and must stay gone.
      expect(result.current.customItems.map((i) => i.name)).toEqual(['Bread'])
    })

    it('does nothing when nothing is checked', async () => {
      const { result } = renderItemsHook([customItem('Bread')])

      act(() => {
        result.current.handleClearChecked()
      })
      await settle()

      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})

// @vitest-environment jsdom
import { StrictMode, useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePantryChanges, type PantryChange } from './use-pantry-changes'

/** The shopping list's ticks and the parent's change map, as the page holds them. */
function useTicks(initial: string[], onProcessed: (listStale: boolean) => void) {
  const [purchasedIds, setPurchasedIds] = useState(new Set(initial))
  const [changes, setChanges] = useState(new Map<string, PantryChange>())
  usePantryChanges(
    changes,
    (listStale) => {
      onProcessed(listStale)
      setChanges(new Map())
    },
    setPurchasedIds,
  )
  const record = (id: string, change: PantryChange) =>
    act(() => setChanges((prev) => new Map(prev).set(id, change)))
  const untick = (id: string) =>
    act(() => setPurchasedIds((prev) => new Set([...prev].filter((other) => other !== id))))
  return { purchasedIds, record, untick }
}

// StrictMode runs each updater twice, as React may in development.
function renderTicks(initial: string[], onProcessed = vi.fn()) {
  return renderHook(() => useTicks(initial, onProcessed), { wrapper: StrictMode })
}

describe('usePantryChanges', () => {
  it('unticks a ticked item on removal and ticks it again on Undo', () => {
    const onProcessed = vi.fn()
    const { result } = renderTicks(['milk', 'rice'], onProcessed)

    result.current.record('milk', 'removed')
    expect([...result.current.purchasedIds]).toEqual(['rice'])
    expect(onProcessed).toHaveBeenLastCalledWith(false)

    result.current.record('milk', 'restored')
    expect([...result.current.purchasedIds].sort()).toEqual(['milk', 'rice'])
    // No re-read: the server drops a bought item, so the ticked row would go.
    expect(onProcessed).toHaveBeenLastCalledWith(false)
  })

  it('leaves an unticked item unticked after a removal and its Undo, and asks for a re-read', () => {
    const onProcessed = vi.fn()
    const { result } = renderTicks(['rice'], onProcessed)

    result.current.record('milk', 'removed')
    result.current.record('milk', 'restored')

    expect([...result.current.purchasedIds]).toEqual(['rice'])
    // The restored row may cover a need again, which only the server knows.
    expect(onProcessed).toHaveBeenLastCalledWith(true)
  })

  it('does not re-tick an item a later removal found unticked', () => {
    const { result } = renderTicks(['milk'])
    result.current.record('milk', 'removed')
    result.current.record('milk', 'restored')
    expect([...result.current.purchasedIds]).toEqual(['milk'])

    // The household unticks it by hand, then removes and restores it again.
    result.current.untick('milk')
    result.current.record('milk', 'removed')
    result.current.record('milk', 'restored')

    expect([...result.current.purchasedIds]).toEqual([])
  })
})

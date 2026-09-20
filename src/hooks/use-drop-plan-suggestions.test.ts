import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { createQueryWrapper } from '@/test/query-wrapper'
import { useDropPlanSuggestions } from './use-drop-plan-suggestions'

function seed(client: QueryClient) {
  client.setQueryData(['meal-suggestions', 'plan-1', 'entry-a', 'swap'], ['alt-1'])
  client.setQueryData(['meal-suggestions', 'plan-1', 'entry-b', 'add'], ['alt-2'])
  client.setQueryData(['meal-suggestions', 'plan-2', 'entry-c', 'swap'], ['alt-3'])
  client.setQueryData(['meal-search', 'chicken'], ['alt-4'])
}

describe('useDropPlanSuggestions', () => {
  it('drops every entry and mode for the plan', () => {
    const { wrapper, queryClient } = createQueryWrapper()
    seed(queryClient)

    const { result } = renderHook(() => useDropPlanSuggestions('plan-1'), { wrapper })
    result.current()

    // Both entries go, and both modes — a swap changes `recentMealIds` for the
    // whole plan, not just the entry that was repointed.
    expect(
      queryClient.getQueryData(['meal-suggestions', 'plan-1', 'entry-a', 'swap']),
    ).toBeUndefined()
    expect(
      queryClient.getQueryData(['meal-suggestions', 'plan-1', 'entry-b', 'add']),
    ).toBeUndefined()
  })

  it('leaves other plans and other query keys alone', () => {
    const { wrapper, queryClient } = createQueryWrapper()
    seed(queryClient)

    const { result } = renderHook(() => useDropPlanSuggestions('plan-1'), { wrapper })
    result.current()

    expect(queryClient.getQueryData(['meal-suggestions', 'plan-2', 'entry-c', 'swap'])).toEqual([
      'alt-3',
    ])
    expect(queryClient.getQueryData(['meal-search', 'chicken'])).toEqual(['alt-4'])
  })
})

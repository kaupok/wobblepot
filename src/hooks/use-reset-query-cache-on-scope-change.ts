import { useEffect, useRef } from 'react'
import type { QueryClient } from '@tanstack/react-query'

/**
 * Empties the query cache when the signed-in user or their household changes
 * without a full page load: a leave, a leave-and-join, a sign-out (HON-1141).
 * Keys such as `['meals']` and `['ai-usage']` are not scoped by household, so
 * without this they show the old household's data until `staleTime` ends.
 *
 * It runs after the commit that brings the new scope. Every one of those flows
 * ends in `router.push()` + `router.refresh()`, so that commit is the
 * destination's: the page being left never refetches against a household that
 * is gone. Inactive entries are removed. Active ones are reset rather than
 * removed, because a removed query does not re-render the component that
 * observes it, and a destination that mounted with old cached data would keep
 * showing it; a reset drops the data, notifies it and refetches.
 *
 * The first render does nothing, so a fresh page load keeps its cache.
 */
export function useResetQueryCacheOnScopeChange(queryClient: QueryClient, scope: string) {
  const previousScope = useRef(scope)

  useEffect(() => {
    if (previousScope.current === scope) return
    previousScope.current = scope
    queryClient.removeQueries({ type: 'inactive' })
    void queryClient.resetQueries({ type: 'active' })
  }, [queryClient, scope])
}

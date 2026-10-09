import { useEffect, useRef } from 'react'
import type { QueryClient } from '@tanstack/react-query'

export interface QueryCacheScope {
  userId?: string | null
  householdId?: string | null
}

/**
 * Empties the query cache when the user leaves a household or stops being the
 * signed-in user without a full page load: a leave, a leave-and-join, a
 * sign-out (HON-1141). Keys such as `['meals']` and `['ai-usage']` are not
 * scoped by household, so without this they show the old household's data
 * until `staleTime` ends.
 *
 * Arriving in a scope from none (a sign-in, a first household) resets
 * nothing: there is no old household's data to drop, and `/recipes` and
 * `/household` hydrate their first page into this cache from the server
 * (HON-770, HON-780), which a reset would throw away.
 *
 * It runs after the commit that brings the new scope. Every one of those flows
 * ends in `router.push()` + `router.refresh()`, so that commit is the
 * destination's: the page being left never refetches against a household that
 * is gone. Inactive entries are removed. Active ones are reset rather than
 * removed, because a removed query does not re-render the component that
 * observes it, and a destination that mounted with old cached data would keep
 * showing it; a reset drops the data, notifies it and refetches.
 */
export function useResetQueryCacheOnScopeChange(
  queryClient: QueryClient,
  { userId = null, householdId = null }: QueryCacheScope,
) {
  const previous = useRef({ userId, householdId })

  useEffect(() => {
    const before = previous.current
    previous.current = { userId, householdId }
    const leftHousehold = before.householdId !== null && before.householdId !== householdId
    const leftUser = before.userId !== null && before.userId !== userId
    if (!leftHousehold && !leftUser) return
    queryClient.removeQueries({ type: 'inactive' })
    void queryClient.resetQueries({ type: 'active' })
  }, [queryClient, userId, householdId])
}

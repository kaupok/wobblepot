'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Drops every cached swap-suggestion list for a plan.
 *
 * `MealSelectorModal` caches its alternatives under
 * `['meal-suggestions', planId, entryId, mode]` at `staleTime: Infinity`, and
 * the components that render it — `MealCard`, `TimelineEmptySlot` — keep it
 * mounted whether or not it is open, so the observer stays subscribed. The
 * modal's own `reset()` on close drops only its *own* entry's list, so reopening
 * it draws a fresh tie-break (HON-709); every other entry's list stays cached.
 *
 * The removal is plan-wide rather than per-entry because both suggestion routes
 * filter candidates through `recentMealIds` — every meal the household has
 * planned within `NO_REPEAT_DAYS`, excluded at
 * `src/lib/meal-planning/candidates.ts` — so any entry gaining or losing a meal
 * changes the candidate set for every *other* entry in the plan. Every card on
 * the page shares one `QueryClient`, so a narrower removal would leave
 * Tuesday's cached list still offering the meal just planned for Monday, and
 * picking it would plan the same dinner twice inside the no-repeat window.
 *
 * Call it from anywhere that assigns or unassigns a meal — a swap, an
 * empty-slot pick, a clear, a plan generation — alongside `router.refresh()`,
 * which re-renders the server tree but cannot reach the query cache (HON-682).
 *
 * Refetching is cheap: both routes are a Prisma query and a scoring pass, and
 * touch AI only through `assertUnderCap`. A cancelled selector changes no meal,
 * so it has no reason to refetch the *other* entries — only its own, via
 * `reset()`.
 */
export function useDropPlanSuggestions(planId: string) {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.removeQueries({ queryKey: ['meal-suggestions', planId] })
  }, [queryClient, planId])
}

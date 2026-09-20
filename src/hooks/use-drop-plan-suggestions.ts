'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Drops every cached swap-suggestion list for a plan.
 *
 * `MealSelectorModal` caches its alternatives under
 * `['meal-suggestions', planId, entryId, mode]` at `staleTime: Infinity`, and
 * the components that render it — `MealCard`, `TimelineEmptySlot` — keep it
 * mounted whether or not it is open, so the observer stays subscribed and the
 * modal's own `reset()` on close clears only the search and my-recipes keys.
 * Nothing else drops it.
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
 * touch AI only through `assertUnderCap`. It is the paths that change no meal
 * at all — a cancelled selector — that have no reason to pay for it.
 */
export function useDropPlanSuggestions(planId: string) {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.removeQueries({ queryKey: ['meal-suggestions', planId] })
  }, [queryClient, planId])
}

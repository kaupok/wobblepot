'use client'

import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Body, Heading, Li, Ul } from '@/components/ui/typography'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { apiFetch } from '@/lib/api'
import { formatAbsoluteDate } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'

/**
 * Outside `['meals']` on purpose: `RecipesPageClient` rewrites every
 * `['meals']` query with an infinite-page updater after a delete.
 */
export const recentlyDeletedMealsQueryKey = ['recently-deleted-meals'] as const

const NO_MEALS: DeletedMeal[] = []

export interface DeletedMeal {
  id: string
  name: string
  deletedAt: string
}

interface RecentlyDeletedMealsProps {
  /**
   * Restore one recipe. `focusCard` asks the list to focus the restored
   * card once it is back, because this row was the last one and the section
   * goes with it.
   */
  onRestore: (mealId: string, focusCard: boolean) => void
  /** The recipe whose restore is in flight, if any. */
  restoringId: string | null
}

/**
 * The household's recipes deleted in the last 30 days, at the end of the
 * Recipes list, closed until opened (HON-1336). Renders nothing while it loads,
 * on a failed load, and when nothing was deleted, so a household that never
 * deletes never sees it.
 *
 * The trigger is a button inside the heading, as in `PreparationNotes`. A
 * Restore button stays focusable while its request runs (`aria-disabled`), so
 * focus survives a failure. After a success focus moves to the next row's
 * Restore, else the previous one's, else the restored card in the list.
 */
export function RecentlyDeletedMeals({ onRestore, restoringId }: RecentlyDeletedMealsProps) {
  const t = useTranslations('recipes.list')
  const locale = useLocale() as Locale
  const restoreRefs = useRef(new Map<string, HTMLButtonElement>())
  // The restore in flight and the row whose Restore takes focus once the
  // restored row has left the list.
  const focusAfterRef = useRef<{ restoredId: string; focusId: string | null } | null>(null)

  const { data } = useQuery({
    queryKey: recentlyDeletedMealsQueryKey,
    queryFn: () => apiFetch<{ meals: DeletedMeal[] }>('/api/households/me/meals/deleted'),
  })
  const meals = data?.meals ?? NO_MEALS

  useEffect(() => {
    const pending = focusAfterRef.current
    if (!pending) return
    const stillListed = meals.some((meal) => meal.id === pending.restoredId)
    if (stillListed) {
      // A failed restore leaves the row and focus on its button.
      if (restoringId === null) focusAfterRef.current = null
      return
    }
    focusAfterRef.current = null
    if (pending.focusId) restoreRefs.current.get(pending.focusId)?.focus()
  }, [meals, restoringId])

  if (meals.length === 0) return null

  const handleRestore = (mealId: string) => {
    if (restoringId) return
    const index = meals.findIndex((meal) => meal.id === mealId)
    const neighbour = meals[index + 1] ?? meals[index - 1]
    focusAfterRef.current = { restoredId: mealId, focusId: neighbour?.id ?? null }
    onRestore(mealId, !neighbour)
  }

  return (
    <Collapsible>
      <div className="-ml-3">
        <Heading variant="section" as="h2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group focus-visible:outline-foreground flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <ChevronRight
                aria-hidden="true"
                className="size-5 shrink-0 transition-transform duration-150 ease-out group-data-[state=open]:rotate-90 motion-reduce:transition-none"
              />
              {t('recentlyDeleted', { count: meals.length })}
            </button>
          </CollapsibleTrigger>
        </Heading>
      </div>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 pt-2">
          <Body variant="muted">{t('recentlyDeletedHint')}</Body>
          <Ul variant="plain">
            {meals.map((meal) => (
              <Li key={meal.id} className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 flex-col">
                  <Body>{meal.name}</Body>
                  <Body variant="muted">
                    {t('deletedOn', {
                      date: formatAbsoluteDate(new Date(meal.deletedAt), locale),
                    })}
                  </Body>
                </div>
                <Button
                  ref={(el) => {
                    if (!el) return
                    restoreRefs.current.set(meal.id, el)
                    return () => {
                      restoreRefs.current.delete(meal.id)
                    }
                  }}
                  variant="outline"
                  size="sm"
                  aria-disabled={restoringId !== null}
                  aria-label={t('restoreAria', { name: meal.name })}
                  onClick={() => handleRestore(meal.id)}
                >
                  {t('restore')}
                </Button>
              </Li>
            ))}
          </Ul>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

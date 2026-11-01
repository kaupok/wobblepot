'use client'

import { Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { KidFriendlyBadge } from '@/components/meal-plan/KidFriendlyBadge'
import { MealBadgeRow } from '@/components/meal-plan/MealBadgeRow'
import { MealImageCard, mealImageTitleWidth } from '@/components/meal-plan/MealImageCard'
import { ProteinBadge } from '@/components/meal-plan/ProteinBadge'
import { Badge } from '@/components/ui/badge'
import { CardContent, CardHeader } from '@/components/ui/card'
import { Body, Heading, Li, Ul } from '@/components/ui/typography'
import type { SampleDay } from '@/lib/meal-plans/build-sample-week'
import { cn } from '@/lib/utils'

/**
 * One day of a public sample week (`/meal-plans/<slug>`, HON-1085): the
 * dinner on the planner's card, with the day where the planner shows the
 * slot, then the meal's ingredients with the quantities for the page's
 * household. A picture of the plan, not a control: no cook view opens from it.
 * A meal without a ready image renders the card's neutral surface.
 */
export function SampleMealCard({ day }: { day: SampleDay }) {
  const tDetail = useTranslations('meal-plan.detail')
  const t = useTranslations('mealPlans')
  const { meal } = day

  return (
    // The day's anchor: each recipe's JSON-LD `url` points here.
    <div id={day.anchor} className="scroll-mt-24">
      <MealImageCard
        meal={meal}
        size="sm"
        head={
          <CardHeader className="px-4 pt-1 pb-1">
            <div className="flex min-h-8 items-center">
              {/* One line, as on the planner card: the day label gives way
                  first and the time keeps the right edge (HON-1577). */}
              <MealBadgeRow>
                <Badge variant="secondary">
                  <span className="truncate">{day.dayName}</span>
                </Badge>
                {meal.kidFriendly && <KidFriendlyBadge compact />}
                <ProteinBadge proteinType={meal.primaryProteinType} />
                {meal.timeMinutes != null && meal.timeMinutes > 0 && (
                  <Badge variant="surface" className="ml-auto">
                    <Clock aria-hidden="true" />
                    {tDetail('timeMinutes', { count: meal.timeMinutes })}
                  </Badge>
                )}
              </MealBadgeRow>
            </div>
            <div className={cn('flex min-w-0 flex-col gap-1 pb-2', mealImageTitleWidth())}>
              <div className="flex min-h-8 items-center">
                <Heading variant="section" as="h3">
                  {meal.name}
                </Heading>
              </div>
              {meal.description && <Body variant="muted">{meal.description}</Body>}
            </div>
          </CardHeader>
        }
      >
        <CardContent className="px-4 pb-2">
          <Ul variant="plain" aria-label={t('ingredientsLabel', { meal: meal.name })}>
            {day.ingredients.map((line) => (
              <Li key={line.id} className="flex items-baseline gap-3">
                {/* Quantity first, in a fixed column, so the names line up. */}
                <span className="w-16 shrink-0 tabular-nums">
                  <Body variant="small">{line.quantity}</Body>
                </span>
                <Body variant="small">{line.name}</Body>
              </Li>
            ))}
          </Ul>
        </CardContent>
      </MealImageCard>
    </div>
  )
}

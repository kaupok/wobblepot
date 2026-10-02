'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CardHeader } from '@/components/ui/card'
import { Body, Heading } from '@/components/ui/typography'
import { KidFriendlyBadge } from '@/components/meal-plan/KidFriendlyBadge'
import { MealDetailModal } from '@/components/meal-plan/MealDetailModal'
import { MealImageCard, mealImageTitleWidth } from '@/components/meal-plan/MealImageCard'
import { MealTypeBadge } from '@/components/meal-plan/MealTypeBadge'
import { ProteinBadge } from '@/components/meal-plan/ProteinBadge'
import { cn } from '@/lib/utils'
import type { DemoDay } from '@/lib/landing/load-demo-day'

interface LandingDemoProps {
  day: DemoDay
  /** The day's weekday name in the visitor's language. */
  dayLabel: string
}

/**
 * Today's three library meals on the signed-out home page, as the planner
 * draws them, and each one opens in the real cook view (`MealDetailModal`
 * `readOnly`): the steps an operator wrote ahead of time, nothing fetched,
 * nothing saved. The meal name is the trigger, as on the planner card. One
 * view, re-keyed by the open meal so ticked steps never carry over.
 */
export function LandingDemo({ day, dayLabel }: LandingDemoProps) {
  const t = useTranslations('landing.demo')
  const [activeIndex, setActiveIndex] = useState(0)
  const [open, setOpen] = useState(false)
  const active = day.meals[activeIndex] ?? day.meals[0]

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        {/* The day label at the timeline's Section size, as a paragraph: an
            example day is not a section of the page's outline. */}
        <Heading variant="section" as="p">
          {dayLabel}
        </Heading>
        <Body variant="muted">{t('hint')}</Body>
      </div>
      <div className="flex flex-col gap-3">
        {day.meals.map((entry, index) => (
          <MealImageCard
            key={entry.meal.id}
            meal={entry.meal}
            size="sm"
            head={
              <CardHeader className="px-4 pt-1 pb-1">
                <div className="flex min-h-8 items-center">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <MealTypeBadge mealType={entry.mealType} />
                    {entry.meal.kidFriendly && <KidFriendlyBadge compact />}
                    {entry.meal.primaryProteinType && (
                      <ProteinBadge proteinType={entry.meal.primaryProteinType} />
                    )}
                  </div>
                </div>
                <div className={cn('flex min-w-0 flex-col', mealImageTitleWidth())}>
                  <div className="flex min-h-8 items-center">
                    <Heading variant="section" as="p">
                      <button
                        type="button"
                        className="cursor-pointer text-left underline-offset-2 hover:underline"
                        onClick={() => {
                          setActiveIndex(index)
                          setOpen(true)
                        }}
                      >
                        {entry.meal.name}
                      </button>
                    </Heading>
                  </div>
                  {entry.meal.description && (
                    <div className="hidden md:line-clamp-2">
                      <Body variant="muted">{entry.meal.description}</Body>
                    </div>
                  )}
                </div>
              </CardHeader>
            }
          />
        ))}
      </div>
      <figcaption className="sr-only">{t('caption')}</figcaption>
      {active && (
        <MealDetailModal
          key={active.meal.id}
          meal={active.meal}
          householdSize={active.servings}
          initialTips={active.steps}
          open={open}
          onOpenChange={setOpen}
          readOnly
        />
      )}
    </figure>
  )
}

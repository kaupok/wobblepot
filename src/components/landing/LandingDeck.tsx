'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Body, Heading } from '@/components/ui/typography'
import { MealDetailModal } from '@/components/meal-plan/MealDetailModal'
import { DemoMealCard } from '@/components/landing/LandingDemo'
import { ShowcaseMealCard } from '@/components/landing/LandingShowcase'
import type { DemoDay, DemoMeal } from '@/lib/landing/load-demo-day'

interface LandingDeckProps {
  /**
   * Today's library meals (`loadDemoDay`), or null when the library cannot
   * fill a day, in which case the static example day (`LandingShowcase`)
   * stands in, as on the live landing.
   */
  day: DemoDay | null
  /** "Thursday · Tonight's dinner", in the visitor's language. */
  caption: string
}

/**
 * Tonight's dinner in front, breakfast and lunch tilted behind it on either
 * side: landing direction B1's hero picture (HON-1116).
 *
 * The deck keeps the live landing's demo (HON-1036) rather than static cards,
 * because opening a real meal in the cook view is the page's one chance to
 * let a visitor use the product before signing up. Only the front card opens
 * it, by its name or a click anywhere on it; the cards behind are decoration
 * (`inert`). The week strip under the deck names the same dinner on today's
 * weekday (`LandingWeek`). With no demo day, all three cards are the static
 * showcase and nothing opens.
 *
 * The side cards reach past the column, and on a phone past the screen; the
 * caller clips them at the viewport's edge.
 */
export function LandingDeck({ day, caption }: LandingDeckProps) {
  const t = useTranslations('landing.demo')
  const [open, setOpen] = useState(false)
  const meal = (type: DemoMeal['mealType']) => day?.meals.find((m) => m.mealType === type)
  const dinner = meal('dinner')
  // A demo day without a dinner has no front card, so the whole deck falls back.
  const demo = dinner ? { breakfast: meal('breakfast'), lunch: meal('lunch'), dinner } : null

  const side = (entry: DemoMeal | undefined, key: 'breakfast' | 'lunch'): ReactNode =>
    demo ? (
      entry && <DemoMealCard entry={entry} description={false} />
    ) : (
      <ShowcaseMealCard meal={key} description={false} />
    )

  return (
    <figure className="flex w-full max-w-md flex-col gap-5">
      <figcaption className="flex flex-col gap-1 text-center text-balance">
        <Heading variant="section" as="p">
          {caption}
        </Heading>
        {demo && <Body variant="muted">{t('hint')}</Body>}
      </figcaption>
      <div className="relative pt-8 pb-10 text-left md:pt-0 md:pb-16">
        <div inert className="absolute top-0 -left-20 w-64 -rotate-6 md:top-10 md:-left-64 md:w-80">
          {side(demo?.breakfast, 'breakfast')}
        </div>
        <div
          inert
          className="absolute top-0 -right-20 w-64 rotate-6 md:top-10 md:-right-64 md:w-80"
        >
          {side(demo?.lunch, 'lunch')}
        </div>
        <div className="relative z-10 rounded-xl shadow-xl">
          {demo ? (
            <DemoMealCard entry={demo.dinner} onOpen={() => setOpen(true)} />
          ) : (
            <ShowcaseMealCard meal="dinner" />
          )}
        </div>
      </div>
      {demo && (
        <MealDetailModal
          meal={demo.dinner.meal}
          householdServings={demo.dinner.servings}
          initialSteps={demo.dinner.steps}
          open={open}
          onOpenChange={setOpen}
          readOnly
        />
      )}
    </figure>
  )
}

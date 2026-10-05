'use client'

import { useState, type MouseEvent } from 'react'
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

// A click on one of these is not a click on the card. The name opens the view
// itself. The Kid-friendly badge is a tooltip trigger drawn as a `span`, so it
// carries the marker rather than matching `button`.
const CARD_CLICK_IGNORE = 'button, a, input, textarea, select, label, [data-card-click-ignore]'

interface LandingDemoProps {
  day: DemoDay
  /** The day's weekday name in the visitor's language. */
  dayLabel: string
}

/**
 * Today's three library meals on the signed-out home page, as the planner
 * draws them, and each one opens in the real cook view (`MealDetailModal`
 * `readOnly`): the steps an operator wrote ahead of time, nothing fetched,
 * nothing saved. The meal name is the trigger, as on the planner card, and a
 * click anywhere else on the card opens it too (HON-1036). One view, re-keyed
 * by the open meal so ticked steps never carry over.
 */
export function LandingDemo({ day, dayLabel }: LandingDemoProps) {
  const t = useTranslations('landing.demo')
  const [activeIndex, setActiveIndex] = useState(0)
  const [open, setOpen] = useState(false)
  const active = day.meals[activeIndex] ?? day.meals[0]

  function openCookView(index: number) {
    setActiveIndex(index)
    setOpen(true)
  }

  // A pointer shortcut, as on the planner card (HON-1010): the name stays the
  // card's keyboard target and accessible name, so the card takes no role, tab
  // stop or keys. Skipped for a click on a control, for a click that ends a
  // text selection, and for a click from outside the card's DOM: React bubbles
  // events out of portals (the badge's tooltip, the open cook view) along its
  // own tree.
  function handleCardClick(index: number, event: MouseEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return
    if (target.closest(CARD_CLICK_IGNORE)) return
    if (window.getSelection()?.toString()) return
    // The press left focus on the page body, and the cook view hands focus
    // back to whatever had it as it opened. Give it the name, as a click on
    // the name would. After a pointer press this shows no focus ring.
    event.currentTarget
      .querySelector<HTMLElement>('[data-slot="card-target"]')
      ?.focus({ preventScroll: true })
    openCookView(index)
  }

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
            interactive
            onClick={(event) => handleCardClick(index, event)}
            head={
              <CardHeader className="px-4 pt-1 pb-1">
                <div className="flex min-h-8 items-center">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <MealTypeBadge mealType={entry.mealType} />
                    {entry.meal.kidFriendly && (
                      <span data-card-click-ignore className="contents">
                        <KidFriendlyBadge compact />
                      </span>
                    )}
                    {entry.meal.primaryProteinType && (
                      <ProteinBadge proteinType={entry.meal.primaryProteinType} />
                    )}
                  </div>
                </div>
                <div className={cn('flex min-w-0 flex-col', mealImageTitleWidth())}>
                  <div className="flex min-h-8 items-center">
                    {/* The card draws the name's focus ring around itself
                        (`card-target`), and the name underlines on a hover
                        anywhere on the card. */}
                    <Heading variant="section" as="p">
                      <button
                        type="button"
                        data-slot="card-target"
                        className="cursor-pointer text-left underline-offset-2 outline-none group-hover/card:underline"
                        onClick={() => openCookView(index)}
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
          householdServings={active.servings}
          initialTips={active.steps}
          open={open}
          onOpenChange={setOpen}
          readOnly
        />
      )}
    </figure>
  )
}

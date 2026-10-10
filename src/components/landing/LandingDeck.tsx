'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Body, Heading } from '@/components/ui/typography'
import { MealDetailModal } from '@/components/meal-plan/MealDetailModal'
import { DemoMealCard } from '@/components/landing/DemoMealCard'
import { ShowcaseMealCard } from '@/components/landing/ShowcaseMealCard'
import type { DemoDay, DemoMeal } from '@/lib/landing/load-demo-day'
import { cn } from '@/lib/utils'

type DeckMeal = DemoMeal['mealType']
type Slot = 'left' | 'front' | 'right'

/**
 * Where each slot puts a card. All three cards share one grid cell at the
 * front card's width, and only transforms move them, so a swap animates
 * without reflowing the text. The cards are wide and short, so a side card
 * must rise above the front card for its badges and name to show. Below `lg`
 * the column is too narrow to fan, so the side cards stack straight up behind
 * the front card, breakfast at the back, and each shows its badge row. From
 * `lg` they fan out to either side, high enough that the name clears the front
 * card. A side card rises or straightens on hover, to say it moves; the front
 * card lifts.
 */
const SLOT_CLASSES: Record<Slot, string> = {
  front: 'z-20 hover:-translate-y-1',
  left: 'z-0 -translate-y-2/3 scale-90 hover:-translate-y-3/4 lg:-translate-x-1/2 lg:-translate-y-3/4 lg:-rotate-4 lg:hover:-translate-y-3/4 lg:hover:-rotate-2 lg:hover:scale-95',
  right:
    'z-10 -translate-y-2/5 scale-95 hover:-translate-y-1/2 lg:z-0 lg:translate-x-1/2 lg:-translate-y-3/4 lg:scale-90 lg:rotate-4 lg:hover:-translate-y-3/4 lg:hover:rotate-2 lg:hover:scale-95',
}

/** The swap's length: the `duration-500` on each card. */
const SWAP_MS = 500

/** The deck as it first shows: tonight's dinner in front. */
const START: Record<Slot, DeckMeal> = { left: 'breakfast', front: 'dinner', right: 'lunch' }

/** The cards in a fixed DOM order, so React moves no node and every swap animates. */
const DOM_ORDER: readonly DeckMeal[] = ['dinner', 'breakfast', 'lunch']

interface LandingDeckProps {
  /**
   * Today's library meals (`loadDemoDay`), or null when the library cannot
   * fill a day, in which case the static example day (`ShowcaseMealCard`)
   * stands in, as on the live landing.
   */
  day: DemoDay | null
  /** The day's weekday name in the visitor's language, for the caption. */
  dayLabel: string
}

/**
 * Tonight's dinner in front, breakfast and lunch behind it: the landing page's hero picture (HON-1116).
 *
 * The deck keeps the live landing's demo (HON-1036) rather than static cards,
 * because opening a real meal in the cook view is the page's one chance to
 * let a visitor use the product before signing up. Every card opens its meal,
 * by its name or a click anywhere on it. A side card first swings to the front
 * and the front card takes its place, then the cook view opens, so the visitor
 * sees the deck answer the click. With reduced motion it opens at once. The
 * caption names the meal in front. The week strip under the deck names
 * tonight's dinner on today's weekday (`LandingWeek`).
 *
 * With no demo day, the three cards are the static showcase: the side cards
 * are decoration (`inert`) and nothing opens.
 *
 * From `lg` the side cards reach past the column; the caller clips them at the
 * viewport's edge.
 */
export function LandingDeck({ day, dayLabel }: LandingDeckProps) {
  const t = useTranslations('landing')
  const [slots, setSlots] = useState(START)
  const [open, setOpen] = useState(false)
  const openTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(openTimer.current), [])

  const entries = day?.meals
  const entry = (type: DeckMeal) => entries?.find((m) => m.mealType === type)
  // A demo day needs all three meals to fill the deck; otherwise the static
  // showcase stands in.
  const demo = entries && DOM_ORDER.every((type) => entry(type)) ? entries : null
  const front = demo ? slots.front : START.front
  const frontEntry = demo ? entry(front) : undefined

  function slotOf(type: DeckMeal): Slot {
    const current = demo ? slots : START
    return (Object.keys(current) as Slot[]).find((slot) => current[slot] === type) ?? 'front'
  }

  function activate(type: DeckMeal) {
    window.clearTimeout(openTimer.current)
    const slot = slotOf(type)
    if (slot === 'front') {
      setOpen(true)
      return
    }
    setSlots((current) => ({ ...current, front: type, [slot]: current.front }))
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    openTimer.current = window.setTimeout(() => setOpen(true), reduced ? 0 : SWAP_MS)
  }

  return (
    <figure className="flex w-full max-w-md flex-col gap-5">
      <figcaption className="flex flex-col gap-1 text-center text-balance">
        <Heading variant="section" as="p">
          {t(`deck.${front}`, { day: dayLabel })}
        </Heading>
        {demo && <Body variant="muted">{t('demo.hint')}</Body>}
      </figcaption>
      <div className="grid pt-20 pb-2 text-left lg:pt-28 lg:pb-6">
        {DOM_ORDER.map((type) => {
          const slot = slotOf(type)
          const demoEntry = demo ? entry(type) : undefined
          return (
            <div
              key={type}
              data-deck-slot={slot}
              inert={!demo && slot !== 'front'}
              className={cn(
                'col-start-1 row-start-1 self-start rounded-xl transition duration-500 ease-out motion-reduce:transition-none',
                SLOT_CLASSES[slot],
              )}
            >
              {demoEntry ? (
                <DemoMealCard entry={demoEntry} onOpen={() => activate(type)} />
              ) : (
                <ShowcaseMealCard meal={type} />
              )}
            </div>
          )
        })}
      </div>
      {frontEntry && (
        <MealDetailModal
          // Re-keyed by the meal, so ticked steps never carry over.
          key={frontEntry.meal.id}
          meal={frontEntry.meal}
          householdServings={frontEntry.servings}
          initialSteps={frontEntry.steps}
          open={open}
          onOpenChange={setOpen}
          readOnly
        />
      )}
    </figure>
  )
}

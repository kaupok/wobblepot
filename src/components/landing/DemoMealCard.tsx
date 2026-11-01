'use client'

import type { MouseEvent } from 'react'

import { KidFriendlyBadge } from '@/components/meal-plan/KidFriendlyBadge'
import { MealBadgeRow } from '@/components/meal-plan/MealBadgeRow'
import { MealImageCard, mealImageTitleWidth } from '@/components/meal-plan/MealImageCard'
import { MealTypeBadge } from '@/components/meal-plan/MealTypeBadge'
import { ProteinBadge } from '@/components/meal-plan/ProteinBadge'
import { CardHeader } from '@/components/ui/card'
import { Body, Heading } from '@/components/ui/typography'
import type { DemoMeal } from '@/lib/landing/load-demo-day'
import { cn } from '@/lib/utils'

// A click on one of these is not a click on the card. The name opens the view
// itself. The Kid-friendly badge is a tooltip trigger drawn as a `span`, so it
// carries the marker rather than matching `button`.
const CARD_CLICK_IGNORE = 'button, a, input, textarea, select, label, [data-card-click-ignore]'

/**
 * Whether a click on a card should open its cook view: a pointer shortcut, as
 * on the planner card (HON-1010). The name stays the card's keyboard target and
 * accessible name, so the card takes no role, tab stop or keys. False for a
 * click on a control, for a click that ends a text selection, and for a click
 * from outside the card's DOM: React bubbles events out of portals (the
 * badge's tooltip, the open cook view) along its own tree.
 */
function cardClickOpens(event: MouseEvent<HTMLDivElement>): boolean {
  const target = event.target
  if (!(target instanceof Element) || !event.currentTarget.contains(target)) return false
  if (target.closest(CARD_CLICK_IGNORE)) return false
  if (window.getSelection()?.toString()) return false
  // The press left focus on the page body, and the cook view hands focus back
  // to whatever had it as it opened. Give it the name, as a click on the name
  // would. After a pointer press this shows no focus ring.
  event.currentTarget
    .querySelector<HTMLElement>('[data-slot="card-target"]')
    ?.focus({ preventScroll: true })
  return true
}

interface DemoMealCardProps {
  entry: DemoMeal
  /**
   * Opens the cook view, from the name or a click anywhere on the card.
   * Without it the card is a picture: no trigger, no hover.
   */
  onOpen?: () => void
  /** The description under the name, from `md`. Off where the card is a small picture. */
  description?: boolean
}

/**
 * One of today's library meals on the planner's card, for the landing page's
 * deck (`LandingDeck`). With `onOpen` the name is a button that opens the
 * cook view, and a click anywhere else on the card opens it too (HON-1036);
 * without it the name is text, for a card drawn as decoration.
 */
export function DemoMealCard({ entry, onOpen, description = true }: DemoMealCardProps) {
  return (
    <MealImageCard
      meal={entry.meal}
      size="sm"
      interactive={Boolean(onOpen)}
      onClick={
        onOpen
          ? (event) => {
              if (cardClickOpens(event)) onOpen()
            }
          : undefined
      }
      head={
        <CardHeader className="px-4 pt-1 pb-1">
          {/* `min-w-0`: the header is a grid, and its column grows to the
              badges' full width otherwise, so the row would overflow the
              card rather than overlap its badges (HON-1577). */}
          <div className="flex min-h-8 min-w-0 items-center">
            <MealBadgeRow>
              <MealTypeBadge mealType={entry.mealType} />
              {entry.meal.kidFriendly && <KidFriendlyBadge compact data-card-click-ignore />}
              {entry.meal.primaryProteinType && (
                <ProteinBadge proteinType={entry.meal.primaryProteinType} />
              )}
            </MealBadgeRow>
          </div>
          <div className={cn('flex min-w-0 flex-col', mealImageTitleWidth())}>
            <div className="flex min-h-8 items-center">
              {/* The card draws the name's focus ring around itself
                  (`card-target`), and the name underlines on a hover
                  anywhere on the card. */}
              <Heading variant="section" as="p">
                {onOpen ? (
                  <button
                    type="button"
                    data-slot="card-target"
                    className="cursor-pointer text-left underline-offset-2 outline-none group-hover/card:underline"
                    onClick={onOpen}
                  >
                    {entry.meal.name}
                  </button>
                ) : (
                  entry.meal.name
                )}
              </Heading>
            </div>
            {description && entry.meal.description && (
              <div className="hidden md:line-clamp-2">
                <Body variant="muted">{entry.meal.description}</Body>
              </div>
            )}
          </div>
        </CardHeader>
      }
    />
  )
}

'use client'

import { useRef, type ReactNode } from 'react'
import { CardContent } from '@/components/ui/card'
import { CARD_CLICK_IGNORE } from '@/components/meal-plan/card-click'
import { MealCardBase } from '@/components/meal-plan/MealCardBase'
import { MealImageCard } from '@/components/meal-plan/MealImageCard'
import type { MealData } from './MealList'

interface RecipeCardProps {
  meal: MealData
  /** The heart and the ⋯ menu, on the name's row. */
  titleActions: ReactNode
  /** Opens the cook view for this recipe (HON-1338). */
  onOpen: () => void
}

/**
 * One recipe on My recipes. A click on the name, the image or anywhere else
 * that is not a control opens the cook view, as on the planner card
 * (HON-1010). The name is the keyboard target and the accessible name, so the
 * card itself takes no role, tab stop or keys.
 */
export function RecipeCard({ meal, titleActions, onOpen }: RecipeCardProps) {
  const nameButtonRef = useRef<HTMLButtonElement>(null)

  // The view hands focus back to whatever had it as it opened. Give it the
  // name first, so a click on the image returns there too. After a pointer
  // press this shows no focus ring.
  function open() {
    nameButtonRef.current?.focus({ preventScroll: true })
    onOpen()
  }

  // The ⋯ menu is not modal, so a press outside it closes it and still clicks
  // the card: that press only closes the menu.
  const pressClosesMenuRef = useRef(false)
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    pressClosesMenuRef.current = !!event.currentTarget.querySelector('[aria-expanded="true"]')
  }
  // Skipped for a click on a control (the name opens the view itself), and
  // for a click that ends a text selection. React bubbles events out of
  // portals along its own tree, so a click in the ⋯ menu reaches this handler
  // too; that is outside the card's DOM, which the first check catches.
  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (pressClosesMenuRef.current) return
    const target = event.target
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return
    if (target.closest(CARD_CLICK_IGNORE)) return
    if (window.getSelection()?.toString()) return
    open()
  }

  return (
    <MealImageCard
      meal={meal}
      layout="bottom"
      // `sm`: the content's own `p-4` is the card's padding; the default
      // `py-6` on top of it doubled the space above the first row.
      size="sm"
      interactive
      onPointerDownCapture={handlePointerDown}
      onClick={handleClick}
      className="flex h-full flex-col"
    >
      <CardContent className="flex-1 p-4">
        {/* h2: the page title is the h1 (HON-747). No ingredient list at
            any width: uncoloured names only, it doubled a phone card
            (HON-784) and left an empty band above the image beside a
            longer list on desktop (HON-819). The cook view carries the list
            with quantities, and nutrition too (HON-1352). */}
        <MealCardBase
          meal={meal}
          nameHeadingTag="h2"
          ingredients="never"
          nutrition="hide"
          ownRecipe="hide"
          onNameClick={open}
          nameButtonRef={nameButtonRef}
          titleActions={titleActions}
        />
      </CardContent>
    </MealImageCard>
  )
}

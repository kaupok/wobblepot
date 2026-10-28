'use client'

import { useRef, type RefObject } from 'react'
import { CARD_CLICK_IGNORE } from './card-click'

/**
 * A click anywhere on the planner card opens the cook view, as the name does
 * (HON-1010). A pointer shortcut only: the name stays the card's keyboard
 * target and accessible name, so the card takes no role, tab stop or keys.
 * Skipped for a click on a control (the name opens the view itself), in the
 * open note editor, and for a click that ends a text selection. React bubbles
 * events out of portals along its own tree, so a click in the ⋯ menu
 * reaches this handler too; that is outside the card's DOM, which the first check catches. The menu is not modal, so a
 * press outside it closes it and still clicks the card: that press only
 * closes the menu.
 */
export function useMealCardClick({
  menuTriggerRef,
  nameButtonRef,
  isNoteEditing,
  onOpen,
}: {
  menuTriggerRef: RefObject<HTMLButtonElement | null>
  nameButtonRef: RefObject<HTMLButtonElement | null>
  isNoteEditing: boolean
  onOpen: () => void
}) {
  const pressClosesMenuRef = useRef(false)
  function onPointerDownCapture() {
    pressClosesMenuRef.current = menuTriggerRef.current?.getAttribute('aria-expanded') === 'true'
  }
  function onClick(event: React.MouseEvent<HTMLDivElement>) {
    if (pressClosesMenuRef.current) return
    const target = event.target
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return
    if (target.closest(CARD_CLICK_IGNORE)) return
    // The open editor's slip belongs to the editor. A read-only card's slip is
    // part of the card.
    if (isNoteEditing && target.closest('[data-slot="meal-image-overlay"] *')) return
    if (window.getSelection()?.toString()) return
    // The press left focus on the page body, and the cook view hands focus
    // back to whatever had it as it opened. Give it the name, as a click on
    // the name would. After a pointer press this shows no focus ring.
    nameButtonRef.current?.focus({ preventScroll: true })
    onOpen()
  }
  return { onPointerDownCapture, onClick }
}

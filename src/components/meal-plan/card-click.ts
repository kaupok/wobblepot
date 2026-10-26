/**
 * What a card click leaves to itself: every control. A card that opens the
 * cook view on a click anywhere (`MealCard`, the My recipes card) skips a
 * click whose target is inside one of these. On the planner card the saved
 * note's slip is a button, and a drag of it stops its own click (`useNoteDrag`).
 */
export const CARD_CLICK_IGNORE =
  'button, a, input, textarea, select, label, [role="menuitem"], [role="option"]'

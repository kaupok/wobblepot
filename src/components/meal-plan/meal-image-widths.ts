/**
 * The `max-width` caps for text inside a `MealImageCard`, so a title and a
 * badge row wrap before the image box and the note's slip. Split from
 * `MealImageCard.tsx` for its size cap; the card re-exports both.
 */

/**
 * The widest the title may be on a tinted card: it wraps before it reaches the
 * image. Fractions of the card's content row, matched to where `IMAGE_BOX`
 * starts in `MealImageCard.tsx` — change the two together. The image's left
 * fade is short (10%): the title never reaches it, so it only softens the
 * box's edge and the plate shows at full strength (HON-1358). An uncapped
 * badge row can run onto the plate (HON-1380).
 *
 * Keyed on the card's own `data-meal-image`, set while an image shows, rather
 * than the meal's fields: a card whose image fails to load drops it, and its
 * title gets the full row back with it. A neutral surface (an image without a
 * hue) keeps the cap; a tint with no image (`fallbackSurface`) does not.
 *
 * A card with an `overlay` (`data-meal-overlay`) keeps the cap without an
 * image too, so the title wraps before the note's slip (`OVERLAY_BOX`) rather
 * than running under it (HON-974).
 */
const TITLE_WIDTH = {
  default:
    'group-data-meal-image/meal-image:max-w-1/2 group-data-meal-overlay/meal-image:max-w-1/2 @md/meal-image:group-data-meal-image/meal-image:max-w-3/8 @md/meal-image:group-data-meal-overlay/meal-image:max-w-3/8',
  trailingActions:
    'group-data-meal-image/meal-image:max-w-1/2 group-data-meal-overlay/meal-image:max-w-1/2 @md/meal-image:group-data-meal-image/meal-image:max-w-3/8 @md/meal-image:group-data-meal-overlay/meal-image:max-w-3/8',
} as const

/** The `max-width` classes for a title inside a `MealImageCard`, matching its image box. */
export function mealImageTitleWidth(trailingActions = false): string {
  return trailingActions ? TITLE_WIDTH.trailingActions : TITLE_WIDTH.default
}

/**
 * The `max-width` for the head's badge rows on a card with an `overlay`: half
 * the content row, which ends before the slip's left edge (`OVERLAY_BOX`) at
 * any width, so a second badge wraps rather than running under the slip
 * (HON-974): the servings override after the pantry badge, and on a short
 * card, which the slip spans top to bottom, the first row's protein and
 * own-recipe badges. A single badge
 * wider than that overflows the cap rather than wrapping; the slip's left
 * edge is set to clear the widest one. Without an overlay the row is uncapped.
 */
export const MEAL_IMAGE_BADGE_ROW_WIDTH = 'group-data-meal-overlay/meal-image:max-w-1/2'

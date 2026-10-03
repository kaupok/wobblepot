/**
 * Length limits on the cook-question request body, shared by the route that
 * enforces them and the hook that sends the body. A module of its own, so the
 * client imports a few numbers and not the prompt builder.
 */

/** The cook's question, after trimming */
export const COOK_QUESTION_MAX_LENGTH = 300

/**
 * The earlier answer sent as `previous.answer` (HON-980). `maxOutputTokens`
 * allows a longer answer than this, so the hook clips it: the start of the
 * answer is what a follow-up refers to.
 */
export const COOK_QUESTION_PREVIOUS_ANSWER_MAX_LENGTH = 1200

/**
 * "You'll need" as the route keeps it (HON-983): at most this many items, each
 * clipped to this length. Clipped, never rejected: the tips schema bounds
 * neither, and a step question sends the list as context.
 */
export const COOK_QUESTION_EQUIPMENT_MAX_ITEMS = 20
export const COOK_QUESTION_EQUIPMENT_ITEM_MAX_LENGTH = 120

/**
 * The first `max` UTF-16 units of `text`, never ending in half an emoji: a
 * lone surrogate makes the prompt invalid Unicode, which the model API rejects.
 */
export function clipText(text: string, max: number): string {
  const clipped = text.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped
}

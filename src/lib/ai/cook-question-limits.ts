/**
 * Length limits on the cook-question request body, shared by the route that
 * enforces them and the hook that sends the body. A module of its own, so the
 * client imports two numbers and not the prompt builder.
 */

/** The cook's question, after trimming */
export const COOK_QUESTION_MAX_LENGTH = 300

/**
 * The earlier answer sent as `previous.answer` (HON-980). `maxOutputTokens`
 * allows a longer answer than this, so the hook clips it: the start of the
 * answer is what a follow-up refers to.
 */
export const COOK_QUESTION_PREVIOUS_ANSWER_MAX_LENGTH = 1200

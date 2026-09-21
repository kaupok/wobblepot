/**
 * Central AI model configuration.
 *
 * All model identifiers used across the app are defined here.
 * Update this file when upgrading models — no need to grep across call sites.
 */

/** Model for meal plan generation and filling empty slots. */
export const PLANNING_MODEL = 'claude-sonnet-5'

/** Model for recipe text extraction and parsing. */
export const RECIPE_MODEL = 'claude-sonnet-5'

/** Model for preparation tips generation (fast/cheap). */
export const TIPS_MODEL = 'claude-sonnet-5'

/** Model for "Imagine a meal" freeform meal generation. */
export const IMAGINE_MODEL = 'claude-sonnet-5'

/** Model for reviewing and correcting imagined meal quantities. */
export const REVIEW_MODEL = 'claude-sonnet-5'

/**
 * Model for generated meal illustrations (HON-726). OpenAI, not Claude: see
 * `src/lib/meal-images/generate.ts`. The judge that checks each image is
 * `REVIEW_MODEL`.
 */
export const MEAL_IMAGE_MODEL = 'gpt-image-2.5-flare'

/**
 * Central AI model configuration.
 *
 * All model identifiers used across the app are defined here.
 * Update this file when upgrading models — no need to grep across call sites.
 */

/** Model for meal plan generation and filling empty slots. */
export const PLANNING_MODEL = 'claude-sonnet-4-6'

/** Model for recipe text extraction and parsing. */
export const RECIPE_MODEL = 'claude-sonnet-4-6'

/** Model for preparation tips generation (fast/cheap). */
export const TIPS_MODEL = 'claude-sonnet-4-6'

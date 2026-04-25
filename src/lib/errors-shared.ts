/**
 * Cross-runtime helpers shared between the server-only `captureApiError` and
 * the client-only `captureClientError`. No third-party SDK imports here so
 * this file is safe to pull from both client and server bundles.
 */

/**
 * Map well-known typed errors to a stable PostHog grouping key. Without this
 * PostHog groups on (message + stack top frame), which fragments because each
 * variant has slightly different message text.
 */
const TYPED_ERROR_FINGERPRINTS: Record<string, string> = {
  MealPlanValidationError: 'MealPlanValidation',
  MealPlanExistsError: 'MealPlanExists',
  InsufficientCandidatesError: 'InsufficientCandidates',
  NoEmptySlotsError: 'NoEmptySlots',
  AiCostCapExceededError: 'AiCostCapExceeded',
  RecipeParseError: 'RecipeParse',
  ExternalApiError: 'ExternalApi',
}

export function errorTypeOf(error: unknown): string {
  if (error instanceof Error) return error.name || 'Error'
  return typeof error
}

export function fingerprintFor(error: unknown): string | undefined {
  if (error instanceof Error) {
    return TYPED_ERROR_FINGERPRINTS[error.name]
  }
  return undefined
}

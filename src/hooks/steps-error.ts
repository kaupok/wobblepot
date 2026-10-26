import type { useTranslations } from 'next-intl'
import { ApiError } from '@/lib/api'
import {
  PREPARATION_STEPS_ERROR_KEYS,
  preparationStepsFallbackKey,
  rateLimitMessage,
  translateErrorCode,
  type PreparationStepsErrorCode,
} from '@/lib/ai/error-codes'
import type { Locale } from '@/lib/i18n/locales'

/**
 * What a failed steps request means to the two hooks that make one: a planned
 * entry's (`useMealSteps`) and a My recipes recipe's (`useRecipeSteps`). Both
 * routes return the same codes.
 */

// Conditions a retry 2s later would only hit again — see `isRetryableStepsError`.
const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'generation_disabled',
  'rate_limited',
  'ai_cap_exceeded',
] satisfies PreparationStepsErrorCode[])

/**
 * Auto-retry once after 2s for retryable server errors.
 *
 * 504 is deliberately excluded: it means the route already spent its full 45s
 * AI budget and gave up, so a retry buys another 45s of spinner — ~92s before
 * the user sees anything — for a request that just demonstrated it does not
 * fit. The other 5xx codes fail fast, so retrying those still costs ~2s
 * (HON-693).
 *
 * The `ai_generation_enabled` kill-switch 503 is excluded too: it will still be
 * off 2s later, and the retry would only spend another rate-limit token.
 *
 * So are the two 429s the household causes itself: its hourly `rate_limited`
 * limit and the monthly `ai_cap_exceeded` cap. Neither clears in 2s, so the
 * retry only delays the message — and on the cap path it spends another hourly
 * token, because the route checks the rate limit before the cap (HON-893).
 * `provider_busy` (Anthropic's own 429) and a codeless 429 still retry: those
 * usually clear in moments.
 */
export function isRetryableStepsError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status !== 504 &&
    !NON_RETRYABLE_CODES.has(error.code ?? '') &&
    (error.status >= 500 || error.status === 429)
  )
}

/**
 * The catalog copy for a failed steps request, under `meal-plan.steps`.
 *
 * Never `error.message`: `apiFetch` fills it from the route's English `error`,
 * which would render verbatim to an Estonian household. The `code` picks the
 * catalog copy; the prose is a console breadcrumb only (HON-888).
 */
export function stepsErrorMessage(
  error: unknown,
  t: ReturnType<typeof useTranslations<'meal-plan.steps'>>,
  locale: Locale,
  logTag: string,
): string {
  // A network failure never reached the route, so it has no code to read.
  if (!(error instanceof ApiError)) return t('errors.tipsFailed')
  const body = error.body as { error?: unknown; message?: unknown }
  console.error(`${logTag} request failed`, {
    status: error.status,
    code: error.code,
    error: body.error,
    message: body.message,
  })
  const { key, values } = rateLimitMessage(
    translateErrorCode(
      error.code,
      PREPARATION_STEPS_ERROR_KEYS,
      preparationStepsFallbackKey(error.status),
    ),
    PREPARATION_STEPS_ERROR_KEYS.rate_limited,
    error.body,
    locale,
  )
  return t(`errors.${key}`, values)
}

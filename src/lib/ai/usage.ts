/**
 * AI usage tracking and per-household monthly cost cap.
 *
 * `assertUnderCap` is the gate: call it before every AI surface. It throws
 * `AiCostCapExceededError` when the household has spent at or above its cap
 * for the current calendar month (computed in the household's local timezone).
 *
 * `recordAiUsage` is fire-and-forget: it writes a usage row and mirrors a
 * `$ai_generation` event to PostHog. The two paths are independent failure
 * domains — neither suppresses the other. A failure on either side must not
 * break AI features — the cap is a safety valve, not a critical path
 * dependency. The DB row is the in-app source of truth; the PostHog event
 * drives dashboards and alerts.
 */

import { NextResponse } from 'next/server'
import { NoObjectGeneratedError, type LanguageModelUsage } from 'ai'
import type { AiFeature } from '@/generated/prisma/enums'
import { getPosthogServer } from '@/lib/posthog-server'
import { prisma } from '@/lib/prisma'
import { getRequestId } from '@/lib/request-id'
import { estimateCostUsd } from './pricing'

export interface AiUsageStats {
  model: string
  /**
   * Uncached input tokens — the count billed at the base input rate. Not the
   * SDK's `usage.inputTokens`, which is the total including cache tiers.
   */
  inputTokens: number
  /** Input tokens served from the prompt cache. */
  cacheReadTokens: number
  /** Input tokens written to the prompt cache. */
  cacheWriteTokens: number
  outputTokens: number
  /**
   * `true` when the SDK response carried no usable input or output count.
   * The counts above are then `0` placeholders, not a free call.
   */
  usageMissing: boolean
  /**
   * `false` when the call was billed but produced no usable object (see
   * `withUsageOnFailure`). Absent means `true`.
   */
  success?: boolean
}

export interface RecordAiUsageInput extends Omit<
  AiUsageStats,
  'usageMissing' | 'cacheReadTokens' | 'cacheWriteTokens'
> {
  householdId: string
  feature: AiFeature
  cacheReadTokens?: number
  cacheWriteTokens?: number
  usageMissing?: boolean
  success?: boolean
  retryCount?: number
  requestId?: string | null
  /**
   * Flat USD to record when `usageMissing` is set, instead of `$0`. For calls
   * with a known per-call price — an image generation (HON-735) — where a
   * missing token count must still count against the cap.
   */
  fallbackCostUsd?: number
}

/**
 * Map the AI SDK's `result.usage` to the stats every AI surface bills against.
 * This is the only place the SDK's token counts are read.
 *
 * In ai@7 both counts are `number | undefined`. A missing (or non-finite) count
 * still records as `0` so the row is written, but sets `usageMissing` so
 * `recordAiUsage` can flag it — a silent `0` is indistinguishable from a free
 * call and never trips the cost cap. No fallback estimate: a wrong number in
 * the cap is worse than a visible zero, so a missing input total zeroes every
 * input tier rather than billing whatever breakdown happens to be present.
 *
 * `usage.inputTokens` is the *total* (`noCache + cacheRead + cacheWrite`), and
 * the tiers are priced differently (HON-648), so the input is split using
 * `usage.inputTokenDetails`. When a provider omits `noCacheTokens`, it is
 * derived from the total minus the cache tiers.
 */
export function toAiUsageStats(model: string, usage: LanguageModelUsage | undefined): AiUsageStats {
  const totalInputTokens = finiteOrNull(usage?.inputTokens)
  const outputTokens = finiteOrNull(usage?.outputTokens)
  const usageMissing = totalInputTokens === null || outputTokens === null

  let inputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0

  if (totalInputTokens !== null) {
    // `inputTokenDetails` is typed as always present, but stay defensive: a
    // provider (or a hand-built usage object) may leave it out entirely.
    const details = usage?.inputTokenDetails as LanguageModelUsage['inputTokenDetails'] | undefined
    cacheReadTokens = finiteOrNull(details?.cacheReadTokens) ?? 0
    cacheWriteTokens = finiteOrNull(details?.cacheWriteTokens) ?? 0
    inputTokens =
      finiteOrNull(details?.noCacheTokens) ??
      Math.max(0, totalInputTokens - cacheReadTokens - cacheWriteTokens)
  }

  return {
    model,
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens: outputTokens ?? 0,
    usageMissing,
  }
}

/**
 * Run a `generateObject` call and still report its usage when it throws
 * `NoObjectGeneratedError`.
 *
 * In ai@7 a response that fails schema validation or cannot be parsed throws
 * instead of returning, but Anthropic has already billed the tokens — and the
 * error carries them. Without this, the `onAiUsage` line after the call never
 * runs, no `ai_usage` row is written, and a household whose responses keep
 * failing validation spends past its cap unchecked (HON-668).
 *
 * On `NoObjectGeneratedError` the usage is reported with `success: false`
 * (still counted toward the cap) and the original error is rethrown, so each
 * caller's error mapping is unchanged. Any other error propagates untouched
 * with nothing recorded. The success path is the caller's: it keeps its own
 * `onAiUsage?.(toAiUsageStats(...))` after the call.
 */
export async function withUsageOnFailure<T>(
  model: string,
  onUsage: ((stats: AiUsageStats) => void | Promise<void>) | undefined,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      // A failing callback must not replace the error the caller maps.
      try {
        await onUsage?.({ ...toAiUsageStats(model, error.usage), success: false })
      } catch (usageError) {
        console.error('Failed to report AI usage for a failed generation:', usageError)
      }
    }
    throw error
  }
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Custom error class thrown by `assertUnderCap` when a household is at or
 * above its monthly cap. Carries the `resetAt` timestamp (start of next
 * calendar month in the household's timezone) and the household's IANA
 * timezone so the route can render the reset date in the user's local time
 * — formatting `resetAt` in UTC produces an off-by-one-day for any timezone
 * east of UTC (including the schema default `Europe/Tallinn`).
 */
export class AiCostCapExceededError extends Error {
  readonly resetAt: Date
  readonly timezone: string

  constructor(resetAt: Date, timezone: string) {
    super('AI usage cap exceeded')
    this.name = 'AiCostCapExceededError'
    this.resetAt = resetAt
    this.timezone = timezone
  }
}

/**
 * Compute the start (inclusive) and end (exclusive) of the current calendar
 * month in the given IANA timezone.
 *
 * Uses two-pass DST convergence: a single-pass offset calculation can land on
 * the wrong side of a DST transition when the boundary itself crosses one.
 * Iterating once more guarantees the returned timestamps render as 00:00:00
 * on the 1st of the month in the target timezone.
 */
export function getMonthBoundaries(
  timezone: string,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const ymd = formatYearMonth(timezone, now)
  const [year, month] = ymd.split('-').map(Number) as [number, number]

  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1

  return {
    start: zonedTimeToUtc(year, month, 1, timezone),
    end: zonedTimeToUtc(nextYear, nextMonth, 1, timezone),
  }
}

/**
 * Sum a household's `estimated_cost_usd` for the current calendar month
 * in the household's timezone.
 *
 * Returns `0` when there are no rows.
 */
export async function getMonthSpendUsd(
  householdId: string,
  now: Date = new Date(),
): Promise<number> {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { timezone: true },
  })

  if (!household) return 0

  const { start, end } = getMonthBoundaries(household.timezone, now)

  const aggregate = await prisma.aiUsage.aggregate({
    where: {
      householdId,
      createdAt: { gte: start, lt: end },
    },
    _sum: { estimatedCostUsd: true },
  })

  const sum = aggregate._sum.estimatedCostUsd
  return sum ? Number(sum) : 0
}

/**
 * Throws `AiCostCapExceededError` when the household's month-to-date spend
 * is at or above its `aiCapUsd`. Resolves silently when under cap.
 *
 * Call this at the top of every AI surface before invoking the model.
 * A single call that crosses the cap is allowed to complete (partial
 * overrun) — refusing mid-stream after Anthropic has already billed us is
 * pointless, and the overrun is bounded by one call's cost.
 */
export async function assertUnderCap(householdId: string, now: Date = new Date()): Promise<void> {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { timezone: true, aiCapUsd: true },
  })

  if (!household) return

  const { start, end } = getMonthBoundaries(household.timezone, now)

  const aggregate = await prisma.aiUsage.aggregate({
    where: {
      householdId,
      createdAt: { gte: start, lt: end },
    },
    _sum: { estimatedCostUsd: true },
  })

  const spend = aggregate._sum.estimatedCostUsd ? Number(aggregate._sum.estimatedCostUsd) : 0
  const cap = Number(household.aiCapUsd)

  if (spend >= cap) {
    throw new AiCostCapExceededError(end, household.timezone)
  }
}

/**
 * Write an `ai_usage` row and mirror a `$ai_generation` event to PostHog.
 * Never throws — DB and PostHog failures are each logged and swallowed
 * independently.
 *
 * Compute `estimatedCostUsd` from the model's price table. Unknown models
 * record `$0` (still useful for visibility into how often that model is used).
 *
 * Cache-read and cache-write tokens are priced into `estimatedCostUsd` and
 * mirrored to PostHog, but the `ai_usage` row has no column for them yet: its
 * `input_tokens` is the uncached count only. Nothing enables prompt caching
 * today; add the columns in the change that does.
 *
 * When `usageMissing` is set the row is still written (0 tokens, `$0` unless
 * `fallbackCostUsd` is given), but the
 * PostHog event carries `$ai_usage_missing: true` and a warning is logged, so
 * an unbilled call is visible instead of passing as a free one.
 */
export async function recordAiUsage(input: RecordAiUsageInput): Promise<void> {
  const usageMissing = input.usageMissing ?? false
  const cacheReadTokens = input.cacheReadTokens ?? 0
  const cacheWriteTokens = input.cacheWriteTokens ?? 0
  const cost =
    usageMissing && input.fallbackCostUsd !== undefined
      ? input.fallbackCostUsd
      : estimateCostUsd({
          model: input.model,
          inputTokens: input.inputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          outputTokens: input.outputTokens,
        })

  if (usageMissing) {
    console.warn(
      `AI usage counts missing from SDK response (feature: ${input.feature}, model: ${input.model}); recording 0 tokens`,
    )
  }

  // Resolve once and reuse so the DB row and PostHog event always see the
  // same id. Explicit input wins (tests, future workers); the AsyncLocalStorage
  // value populated by `withRequestId` is the ambient fallback for normal
  // route-handler calls.
  const requestId = input.requestId ?? getRequestId() ?? null

  try {
    await prisma.aiUsage.create({
      data: {
        householdId: input.householdId,
        feature: input.feature,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        estimatedCostUsd: cost,
        success: input.success ?? true,
        retryCount: input.retryCount ?? 0,
        requestId,
      },
    })
  } catch (error) {
    console.error('Failed to record AI usage:', error)
  }

  // PostHog mirror — independent failure domain from the DB write so a
  // PostHog outage doesn't suppress DB writes (and vice-versa). Per-request
  // flush is handled by the SDK's `flushAt: 1 + waitUntil` config in
  // `posthog-server.ts`; no `flush()` needed at the call site.
  try {
    const posthog = getPosthogServer()
    posthog?.capture({
      distinctId: input.householdId,
      event: '$ai_generation',
      properties: {
        $ai_input_tokens: input.inputTokens,
        $ai_cache_read_input_tokens: cacheReadTokens,
        $ai_cache_creation_input_tokens: cacheWriteTokens,
        $ai_output_tokens: input.outputTokens,
        $ai_model: input.model,
        $ai_total_cost_usd: cost,
        $ai_provider: providerFor(input.model),
        $ai_trace_id: requestId ?? undefined,
        $ai_is_error: !(input.success ?? true),
        feature: input.feature,
        household_id: input.householdId,
        retry_count: input.retryCount ?? 0,
        ...(usageMissing && { $ai_usage_missing: true }),
      },
    })
  } catch (error) {
    console.error('Failed to stream AI usage to PostHog:', error)
  }
}

/**
 * Build the standard 429 response for an over-cap call. Mirrors the rate-limit
 * 429 shape used elsewhere so existing UI handlers can treat both identically.
 */
export function respondCapExceeded(error: AiCostCapExceededError): NextResponse {
  const seconds = Math.max(1, Math.ceil((error.resetAt.getTime() - Date.now()) / 1000))
  // en-CA produces YYYY-MM-DD; format in the household's local timezone so a
  // Tallinn user sees "2026-05-01" and not the UTC slice "2026-04-30".
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: error.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(error.resetAt)
  return NextResponse.json(
    {
      error: 'AI usage cap exceeded',
      // Machine-readable, so the AI clients can render a translated string
      // instead of the English `message` below (HON-700). Callers that still
      // read `message` are unaffected — this is purely additive.
      code: 'ai_cap_exceeded',
      message: `You've hit this month's AI usage cap. It resets on ${localDate}.`,
      resetAt: error.resetAt.toISOString(),
    },
    {
      status: 429,
      headers: { 'Retry-After': String(seconds) },
    },
  )
}

/** PostHog's `$ai_provider`. Every model is Claude except the meal-image one (HON-735). */
function providerFor(model: string): 'anthropic' | 'openai' {
  return model.startsWith('gpt-') ? 'openai' : 'anthropic'
}

function formatYearMonth(timezone: string, instant: Date): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  })
  return dtf.format(instant)
}

function zonedTimeToUtc(year: number, month: number, day: number, timezone: string): Date {
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0)
  let offset = getOffsetMs(utcGuess, timezone)
  // Single iteration is enough for non-DST cases; second iteration handles
  // boundary crossings where the offset at the guess differs from the offset
  // at the corrected instant.
  let result = utcGuess - offset
  offset = getOffsetMs(result, timezone)
  result = utcGuess - offset
  return new Date(result)
}

function getOffsetMs(utcMs: number, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  })
  const parts: Record<string, number> = {}
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') parts[part.type] = parseInt(part.value, 10)
  }
  const tzAsUtc = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  )
  return tzAsUtc - utcMs
}

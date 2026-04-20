/**
 * AI usage tracking and per-household monthly cost cap.
 *
 * `assertUnderCap` is the gate: call it before every AI surface. It throws
 * `AiCostCapExceededError` when the household has spent at or above its cap
 * for the current calendar month (computed in the household's local timezone).
 *
 * `recordAiUsage` is fire-and-forget: it writes a usage row but never throws.
 * A DB hiccup must not break AI features — the cap is a safety valve, not a
 * critical path dependency. PostHog streaming for visualisation lives in HON-475;
 * this module is the in-app source of truth.
 */

import { NextResponse } from 'next/server'
import type { AiFeature } from '@/generated/prisma/enums'
import { prisma } from '@/lib/prisma'
import { estimateCostUsd } from './pricing'

export interface AiUsageStats {
  model: string
  inputTokens: number
  outputTokens: number
}

export interface RecordAiUsageInput extends AiUsageStats {
  householdId: string
  feature: AiFeature
  success?: boolean
  retryCount?: number
  requestId?: string | null
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
 * Write an `ai_usage` row. Never throws — DB hiccups are logged and swallowed.
 *
 * Compute `estimatedCostUsd` from the model's price table. Unknown models
 * record `$0` (still useful for visibility into how often that model is used).
 */
export async function recordAiUsage(input: RecordAiUsageInput): Promise<void> {
  const cost = estimateCostUsd({
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
  })

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
        requestId: input.requestId ?? null,
      },
    })
  } catch (error) {
    console.error('Failed to record AI usage:', error)
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
      message: `You've hit this month's AI usage cap. It resets on ${localDate}.`,
      resetAt: error.resetAt.toISOString(),
    },
    {
      status: 429,
      headers: { 'Retry-After': String(seconds) },
    },
  )
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

import type { StructuredTips } from '@/components/meal-plan/types'

/**
 * Parse a stored preparationTips string from the database.
 * Returns the structured tips object if valid JSON, or null for old plain text format.
 */
export function parseStoredTips(stored: string): StructuredTips | null {
  try {
    const parsed = JSON.parse(stored)
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.pitfalls)) {
      return parsed as StructuredTips
    }
    return null
  } catch {
    // Old plain text format — discard and regenerate
    return null
  }
}

/**
 * The tips as the entry caches them, with the servings their prompt was priced
 * at, so a read can tell whether they still match the entry (HON-1040).
 */
export function serializeTips(tips: StructuredTips, servings: number): string {
  return JSON.stringify({ ...tips, servings })
}

/**
 * An entry's cached tips, or null when they were priced at other servings than
 * the entry cooks for now, so the caller regenerates instead of serving them.
 *
 * - `servings` is what the entry cooks for now: `getEffectiveServings` with the
 *   household's `sumPortions`.
 * - `legacyServings` is what a cache without a stored `servings` was priced
 *   at: `servingOverride ?? the member count`, the rule before HON-1040.
 *
 * The invalidation on membership and portion writes clears most stale rows,
 * but it cannot reach tips written by code that predates it: production
 * migrates before the new code is live, and the old code keeps caching tips at
 * the member count in that gap. Checking on read closes that gap and any
 * future one.
 */
export function parseCachedTips(
  stored: string,
  { servings, legacyServings }: { servings: number; legacyServings: number },
): StructuredTips | null {
  const parsed = parseStoredTips(stored) as (StructuredTips & { servings?: unknown }) | null
  if (!parsed) return null
  const { servings: pricedAt, ...tips } = parsed
  const priced = typeof pricedAt === 'number' ? pricedAt : legacyServings
  return priced === servings ? tips : null
}

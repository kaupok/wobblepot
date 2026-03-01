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

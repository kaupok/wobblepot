import type { ImaginedMealResponse } from '@/lib/imagine-utils'

const STORAGE_KEY = 'imagined-meals'

/**
 * Where the imagine flow sends the user back to. Written into the
 * `prefilled-meal` payload as `returnTo` so the create form can route Cancel
 * back here instead of dropping the user in the library.
 */
export const IMAGINE_ROUTE = '/recipes/imagine'

export interface ImagineSession {
  prompt: string
  meals: ImaginedMealResponse[]
  /**
   * Diagnostic only — nothing reads it to expire the stash. The tab's lifetime
   * is the intended TTL, which `sessionStorage` already enforces for us.
   */
  createdAt: number
}

/**
 * Validation is shallow but covers every field the restore path dereferences:
 * a restored meal goes straight into `<MealCardBase>`, which reads `nutrition`
 * (`NutritionSummary` → `nutrition.calories`), maps over `components`, and
 * translates `primaryProteinType`. Checking only `id`/`name` would let a
 * hand-edited value through to the error boundary — the exact failure this
 * guard exists to turn into a clean "no stash".
 */
function isImagineSession(value: unknown): value is ImagineSession {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.prompt !== 'string') return false
  if (typeof candidate.createdAt !== 'number') return false
  if (!Array.isArray(candidate.meals)) return false
  return candidate.meals.every((meal) => {
    if (typeof meal !== 'object' || meal === null) return false
    const entry = meal as Record<string, unknown>
    return (
      typeof entry.id === 'string' &&
      typeof entry.name === 'string' &&
      typeof entry.primaryProteinType === 'string' &&
      Array.isArray(entry.components) &&
      typeof entry.nutrition === 'object' &&
      entry.nutrition !== null
    )
  })
}

/**
 * Persist the current imagine session for the lifetime of the tab, so leaving
 * for the create form and coming back does not cost another AI generation.
 * Attached images are deliberately not persisted — they are `File` objects.
 */
export function saveImagineSession(session: {
  prompt: string
  meals: ImaginedMealResponse[]
}): void {
  if (typeof window === 'undefined') return
  try {
    const payload: ImagineSession = { ...session, createdAt: Date.now() }
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Storage unavailable (Safari private mode, quota). Losing the stash only
    // costs a re-generation — never the page.
  }
}

/** Returns null for an absent, unreadable, or malformed stash. Never throws. */
export function loadImagineSession(): ImagineSession | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY)
    if (!stored) return null
    const parsed: unknown = JSON.parse(stored)
    return isImagineSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function clearImagineSession(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Same reasoning as saveImagineSession.
  }
}

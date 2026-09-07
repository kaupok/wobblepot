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
  createdAt: number
}

/**
 * Shallow validation only. We are the sole writer of this key, so the point is
 * to survive a hand-edited or truncated value rather than to re-verify the
 * whole `ImaginedMealResponse` tree — `id` and `name` are what the results grid
 * keys and renders on.
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
    return typeof entry.id === 'string' && typeof entry.name === 'string'
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

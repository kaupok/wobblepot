import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Every custom value in the `--spacing-*` family, as declared in
 * `src/app/globals.css`. `touch` is ours (`--spacing-touch: 44px`, HON-609).
 *
 * tailwind-merge only knows Tailwind's built-in scale, so without registering
 * these it does not recognise `h-touch` / `size-touch` / `min-h-touch` as
 * members of the height groups and silently keeps both sides of a conflict:
 * `cn('h-8', 'h-touch')` returned "h-8 h-touch" and left the cascade to pick a
 * winner. That matters now that `Button`, `Input`, and `Select` are sized with
 * the token (HON-612) — every callsite that overrides a control's height goes
 * through here.
 *
 * Must stay in sync with `globals.css`; `utils.test.ts` fails if the two drift.
 *
 * Colour tokens need no equivalent list — tailwind-merge's `color` scale is
 * `isAny`, so it accepts arbitrary names. Radius is **not** in that group: its
 * scale is `isTshirtSize`, so `--radius-sm/md/lg/xl` resolve only because they
 * happen to be t-shirt names, and a `--radius-card` would reproduce this bug
 * unguarded. The same holds for `--text-*`, `--shadow-*`, `--blur-*` and
 * `--container-*`.
 */
export const CUSTOM_SPACING_VALUES = ['touch'] as const

/**
 * Every custom `@utility` declared in `src/app/globals.css`, mapped to the
 * tailwind-merge class group it belongs to (HON-673).
 *
 * `CUSTOM_SPACING_VALUES` is the wrong list for these: it feeds
 * `extend.theme.spacing`, which makes a *value* (`touch`) a member of every
 * spacing-shaped group at once. An `@utility` is a whole class name, not a
 * value, and `grid-cols-timeline` is not a spacing group at all — so they are
 * registered as `classGroups` members instead.
 *
 * Without this, tailwind-merge treats the name as unknown and keeps both sides
 * of a conflict: `cn('max-h-dialog', 'max-h-96')` returned both classes, where
 * the `max-h-[85vh]` it replaced correctly lost to the later one. Three modals
 * pass `max-h-dialog` through `DialogContent`'s `cn(base, className)`, so this
 * is the same silent hole `h-touch` had before HON-626 — see the note above.
 *
 * Must stay in sync with `globals.css`; `utils.test.ts` fails if the two drift.
 */
export const CUSTOM_UTILITY_CLASS_GROUPS = {
  'max-h': ['max-h-dialog'],
  'max-w': ['max-w-page'],
  'min-h': ['min-h-screen-below-header', 'min-h-screen-below-header-gutters'],
  'grid-cols': ['grid-cols-timeline', 'grid-cols-shopping-row'],
  'scroll-mt': ['scroll-mt-below-header'],
} as const

const twMerge = extendTailwindMerge({
  extend: {
    theme: { spacing: [...CUSTOM_SPACING_VALUES] },
    // Spread rather than re-listed, so the const above is the only place a
    // utility is named. `readonly` has to be widened for tailwind-merge's type.
    classGroups: Object.fromEntries(
      Object.entries(CUSTOM_UTILITY_CLASS_GROUPS).map(([group, names]) => [group, [...names]]),
    ),
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Returns true when the user has expressed a preference for reduced motion —
 * either through the OS-level `prefers-reduced-motion: reduce` media query, or
 * via the Storybook `data-reduced-motion="true"` attribute on `<html>`. CSS
 * handles most animations, but JS-initiated smooth scrolls bypass the media
 * query, so callers like `MealForm` check this helper before passing
 * `behavior: 'smooth'` to `scrollIntoView`.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  if (document.documentElement.getAttribute('data-reduced-motion') === 'true') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const DEFAULT_REDIRECT = '/'

/**
 * Validates and returns a safe return URL.
 * Prevents open redirect attacks by only allowing relative paths.
 */
export function getValidReturnUrl(url: string | null): string {
  if (!url) return DEFAULT_REDIRECT

  // Must start with / but not // (protocol-relative URL)
  if (!url.startsWith('/') || url.startsWith('//')) {
    return DEFAULT_REDIRECT
  }

  // Block backslashes (some browsers normalize \ to /)
  if (url.includes('\\')) {
    return DEFAULT_REDIRECT
  }

  // Block encoded sequences that could become dangerous when decoded
  try {
    const decoded = decodeURIComponent(url)
    if (decoded.startsWith('//') || decoded.includes('\\')) {
      return DEFAULT_REDIRECT
    }
  } catch {
    // If decoding fails, the URL is likely malformed - reject it
    return DEFAULT_REDIRECT
  }

  return url
}

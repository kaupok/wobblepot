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

const twMerge = extendTailwindMerge({
  extend: { theme: { spacing: [...CUSTOM_SPACING_VALUES] } },
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

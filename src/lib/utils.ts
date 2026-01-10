import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const DEFAULT_REDIRECT = '/profile'

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

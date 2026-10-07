import type { Metadata } from 'next'
import { getServerFlag } from '@/lib/feature-flags'
import { getLocale } from '@/lib/i18n/get-locale'
import { LandingB1 } from './LandingB1'

// A preview, not a page to find: kept out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * Temporary preview of landing direction B1 (the centred hero with a card
 * deck and the week under it), beside the live landing on `/`, so the two can
 * be compared in a browser. Shown signed in or out. Remove it when the
 * direction replaces `LandingPage` or is dropped.
 */
export default async function LandingB1Page() {
  const [inviteRequired, locale] = await Promise.all([
    getServerFlag('invite_code_required', 'anonymous'),
    getLocale(),
  ])
  // Awaited rather than rendered as `<LandingB1 />`, as `src/app/page.tsx` does
  // for `LandingPage`.
  return await LandingB1({ inviteRequired, locale })
}

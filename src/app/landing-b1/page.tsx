import type { Metadata } from 'next'
import { getServerFlag } from '@/lib/feature-flags'
import { getLocale } from '@/lib/i18n/get-locale'
import { DEMO_TIMEZONE, loadDemoDay } from '@/lib/landing/load-demo-day'
import { getTodayInTimezone } from '@/lib/meal-planning/dates'
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
  // The live landing's demo day, so the deck's front card opens the cook view.
  const demo = await loadDemoDay({ locale, date: getTodayInTimezone(DEMO_TIMEZONE) })
  // Awaited rather than rendered as `<LandingB1 />`, as `src/app/page.tsx` does
  // for `LandingPage`.
  return await LandingB1({ inviteRequired, locale, demo })
}

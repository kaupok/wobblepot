import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'

import { PastMealsList } from '@/components/timeline'
import { buildPastDays } from '@/components/timeline/past-days'
import { Button } from '@/components/ui/button'
import { Body, Heading } from '@/components/ui/typography'
import { getHouseholdMembership } from '@/lib/household'
import type { Locale } from '@/lib/i18n/locales'
import { toDateString } from '@/lib/meal-planning/dates'
import { getExpectedMealTypes } from '@/lib/meal-planning/expected-meal-types'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { getPastMealsRange } from '@/lib/meal-planning/past-meals'
import { sumPortions } from '@/lib/meal-planning/servings'
import { loadFrequentMeals, loadRecentFridgeLabels } from '@/lib/meal-plans/past-logging'
import { getSession } from '@/lib/session'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pastMeals')
  return { title: t('metaTitle') }
}

/**
 * The past days, newest first, where the household marks meals cooked or
 * skipped, and logs what it ate in an empty slot (HON-1383). Moved off Today
 * so reviewing them never pushes Today off screen (HON-1007); a dot on the
 * account menu says when some need marking (HON-1028). `?weeks=N` reaches N
 * weeks back, set by "Show the week before".
 */
export default async function PastMealsPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>
}) {
  const session = await getSession()

  if (!session) {
    redirect('/sign-in')
  }

  // Overlap the translations with the membership read: `getTranslations`
  // resolves the locale through the same cached membership row.
  const [membership, t, locale, { weeks }] = await Promise.all([
    getHouseholdMembership(session.user.id),
    getTranslations('pastMeals'),
    getLocale(),
    searchParams,
  ])

  if (!membership) {
    redirect('/onboarding')
  }

  const { household } = membership

  // The household's day, as on Today, so "yesterday" is theirs and not the
  // server's. The first week is the range the account menu's dot counts; "Show
  // the week before" stops at the week the household was created in.
  const range = getPastMealsRange(household.timezone, {
    weeks: Number(weeks ?? 1),
    createdAt: household.createdAt,
  })

  const [{ entries, planId }, pantry, frequentMeals, recentLabels] = await Promise.all([
    // `endDate` is exclusive, so today is not included.
    loadPlanEntries(household, { startDate: range.startDate, endDate: range.endDate }),
    loadPantry(household, { days: null }),
    loadFrequentMeals(household),
    loadRecentFridgeLabels(household),
  ])
  const days = buildPastDays(entries, {
    startDate: toDateString(range.startDate),
    todayDate: range.todayDate,
    expectedMealTypes: getExpectedMealTypes(household.preferences),
    locale: locale as Locale,
  })

  return (
    <div className="w-full px-4 py-8">
      {/* A list page: the title on the page background and the list at full
          width (docs/DESIGN.md → Lists fill, forms stay narrow). */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Heading variant="h4" as="h1">
            {t('title')}
          </Heading>
          <Body variant="muted">{t('description')}</Body>
        </div>

        {/* No day in range has a row or an empty slot, or the household has
            no plan to log into yet. */}
        {days.length === 0 || !planId ? (
          <div className="flex flex-col items-start gap-4">
            <Body variant="muted">{t('empty')}</Body>
            <Button asChild>
              <Link href="/">{t('backToPlan')}</Link>
            </Button>
          </div>
        ) : (
          <PastMealsList
            days={days}
            planId={planId}
            householdServings={sumPortions(household.members)}
            pantryItems={pantry.items}
            log={{ frequentMeals, recentLabels }}
            weeks={range.weeks}
            hasEarlierWeek={range.hasEarlierWeek}
          />
        )}
      </div>
    </div>
  )
}

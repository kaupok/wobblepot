import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/session'
import { getHouseholdMembership } from '@/lib/household'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { getPastMealsRange } from '@/lib/meal-planning/past-meals'
import { PastMealsList } from '@/components/timeline'
import { Body, Heading } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'

/**
 * The past seven days, newest first, where the household marks meals cooked or
 * skipped. Moved off Today so reviewing them never pushes Today off screen
 * (HON-1007); a dot on the account menu says when some need marking (HON-1028).
 */
export default async function PastMealsPage() {
  const session = await getSession()

  if (!session) {
    redirect('/sign-in')
  }

  // Overlap the translations with the membership read: `getTranslations`
  // resolves the locale through the same cached membership row.
  const [membership, t] = await Promise.all([
    getHouseholdMembership(session.user.id),
    getTranslations('pastMeals'),
  ])

  if (!membership) {
    redirect('/onboarding')
  }

  const { household } = membership

  // The household's day, as on Today, so "yesterday" is theirs and not the
  // server's. The same range the account menu's dot counts.
  const { todayDate, startDate, endDate } = getPastMealsRange(household.timezone)

  const [{ entries, planId }, pantry] = await Promise.all([
    // `endDate` is exclusive, so today is not included.
    loadPlanEntries(household, { startDate, endDate }),
    loadPantry(household, { days: null }),
  ])
  // A slot with only a note has nothing to mark, so it is not a row. Filtered
  // here so the empty state and the list agree on what counts (HON-1018).
  const mealEntries = entries.filter((entry) => entry.meal)

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

        {mealEntries.length === 0 || !planId ? (
          <div className="flex flex-col items-start gap-4">
            <Body variant="muted">{t('empty')}</Body>
            <Button asChild>
              <Link href="/">{t('backToPlan')}</Link>
            </Button>
          </div>
        ) : (
          <PastMealsList
            entries={mealEntries}
            planId={planId}
            householdSize={household._count.members}
            pantryItems={pantry.items}
            todayDate={todayDate}
          />
        )}
      </div>
    </div>
  )
}

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/session'
import { getHouseholdMembership } from '@/lib/household'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { getTodayInTimezone, parseLocalDate } from '@/lib/meal-planning/dates'
import { PastMealsList } from '@/components/timeline'
import { Body, Heading } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'

/** How far back the page reaches. An archive beyond this is out of scope. */
const PAST_DAYS = 7

/**
 * The past seven days, newest first, where the household marks meals cooked or
 * skipped. Moved off Today so reviewing them never pushes Today off screen;
 * Today keeps a notice with the count that links here (HON-1007).
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
  // server's.
  const todayDate = getTodayInTimezone(household.timezone)
  const todayParsed = parseLocalDate(todayDate)
  const startDate = new Date(todayParsed)
  startDate.setDate(startDate.getDate() - PAST_DAYS)

  const [{ entries, planId }, pantry] = await Promise.all([
    // `endDate` is exclusive, so today is not included.
    loadPlanEntries(household, { startDate, endDate: todayParsed }),
    loadPantry(household, { days: null }),
  ])

  const pantryIngredients = pantry.items.map((item) => ({
    ingredientId: item.ingredient.id,
    isStaple: item.isStaple,
  }))

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

        {entries.length === 0 || !planId ? (
          <div className="flex flex-col items-start gap-4">
            <Body variant="muted">{t('empty')}</Body>
            <Button asChild>
              <Link href="/">{t('backToPlan')}</Link>
            </Button>
          </div>
        ) : (
          <PastMealsList
            entries={entries}
            planId={planId}
            householdSize={household._count.members}
            pantryIngredients={pantryIngredients}
            pantryItems={pantry.items}
            todayDate={todayDate}
          />
        )}
      </div>
    </div>
  )
}

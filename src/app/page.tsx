import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { CheckCircle2 } from 'lucide-react'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { auth } from '@/lib/auth'
import { getServerFlag } from '@/lib/feature-flags'
import { getHouseholdMembership } from '@/lib/household'
import { getLocale } from '@/lib/i18n/get-locale'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'
import { SUPPORT_EMAIL, supportMailtoHref } from '@/lib/support'
import { getTodayInTimezone, getUrgencyBucket, parseLocalDate } from '@/lib/meal-planning/dates'
import { TimelineView } from '@/components/timeline'
import { FirstTimeSetup } from '@/components/timeline'
import type { ComponentProps } from 'react'
import type { ExpectedMealTypes } from '@/components/meal-plan/types'

type TimelineShoppingItem = ComponentProps<typeof TimelineView>['shoppingItems'][number]

export default async function Home() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  // Landing page for unauthenticated users
  if (!session) {
    const [t, tSignUp, inviteRequired] = await Promise.all([
      getTranslations('landing'),
      getTranslations('auth.signUp'),
      getServerFlag('invite_code_required', 'anonymous'),
    ])
    return (
      <div className="min-h-screen-below-header grid place-items-center px-4">
        {/* Not <main>: the root layout's <main id="main-content"> is the page landmark (HON-820). */}
        <div className="flex max-w-2xl flex-col items-center gap-8 text-center">
          <div className="flex flex-col gap-4">
            <Heading>{t('headline')}</Heading>
            <Body variant="lead">{t('sub')}</Body>
          </div>

          {inviteRequired && (
            <div
              className="border-primary/30 bg-primary/5 max-w-md rounded-md border px-4 py-2"
              role="note"
              aria-label={tSignUp('privateBetaNoticeLabel')}
            >
              <Body variant="paragraph">
                {t('privateBeta')}{' '}
                {tSignUp.rich('requestInvite', {
                  email: SUPPORT_EMAIL,
                  link: (chunks) => (
                    <a
                      href={supportMailtoHref(tSignUp('requestInviteSubject'))}
                      className="underline"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </Body>
            </div>
          )}

          <Button asChild size="lg">
            <Link href="/sign-up">{t('cta')}</Link>
          </Button>

          <ul className="flex flex-col gap-3 text-left">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="text-primary h-5 w-5 shrink-0" />
              <Body>{t('feature1')}</Body>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="text-primary h-5 w-5 shrink-0" />
              <Body>{t('feature2')}</Body>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="text-primary h-5 w-5 shrink-0" />
              <Body>{t('feature3')}</Body>
            </li>
          </ul>
        </div>
      </div>
    )
  }

  // Check household membership
  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    redirect('/onboarding')
  }

  const { household } = membership

  // Get today's date in household timezone
  const todayDate = getTodayInTimezone(household.timezone)
  const todayParsed = parseLocalDate(todayDate)

  // Compute date range: -7 to +14 from today
  const sevenDaysAgo = new Date(todayParsed)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const fourteenDaysAhead = new Date(todayParsed)
  fourteenDaysAhead.setDate(fourteenDaysAhead.getDate() + 15) // +15 because endDate is exclusive

  // Rode along on the membership query's `_count` — no round-trip of its own.
  const householdSize = household._count.members

  // Read straight from the loaders the API routes wrap, not over HTTP into our
  // own deployment (HON-789). A loader that throws is not caught here: it
  // reaches `src/app/error.tsx` rather than rendering Today as if the plan,
  // pantry or shopping list were empty, and a failed entries load can never be
  // mistaken for a first-time household.
  const locale = await getLocale()
  const [{ entries, planId }, pantry, shoppingList] = await Promise.all([
    loadPlanEntries(household, { startDate: sevenDaysAgo, endDate: fourteenDaysAhead }),
    loadPantry(household, { days: null }),
    loadShoppingList(household, { days: 7, locale }),
  ])

  // First-time user: no entries and no plan
  if (entries.length === 0 && !planId) {
    return <FirstTimeSetup userName={session.user.name} />
  }

  const pantryItems = pantry.items
  const pantryIngredients = pantry.items.map((item) => ({
    ingredientId: item.ingredient.id,
    isStaple: item.isStaple,
  }))

  const shoppingItems: TimelineShoppingItem[] = shoppingList.groups.flatMap((group) =>
    group.items.map((item) => ({
      ingredientId: item.ingredientId,
      name: item.name,
      displayQuantity: item.displayQuantity,
      neededByDate: item.neededByDate,
      neededByRelative: item.neededByRelative,
      purchased: item.purchased,
      // Bucket against the household's day, not the server's (HON-762).
      urgency: getUrgencyBucket(item.neededByDate, new Date(todayParsed)),
    })),
  )

  // Expected meal types come off the membership row, which already eager-loads
  // `preferences` — no request to /api/households/me/preferences (HON-676).
  // A household with no `household_preferences` row has `preferences: null`
  // and keeps the dinner-only defaults (HON-672).
  const expectedMealTypes: ExpectedMealTypes = {
    weekdayMealTypes: ['dinner'],
    weekendMealTypes: ['dinner'],
  }
  if (household.preferences?.weekdayMealTypes.length) {
    expectedMealTypes.weekdayMealTypes = household.preferences.weekdayMealTypes
  }
  if (household.preferences?.weekendMealTypes.length) {
    expectedMealTypes.weekendMealTypes = household.preferences.weekendMealTypes
  }

  return (
    <TimelineView
      entries={entries}
      planId={planId ?? ''}
      expectedMealTypes={expectedMealTypes}
      householdSize={householdSize}
      pantryIngredients={pantryIngredients}
      pantryItems={pantryItems}
      shoppingItems={shoppingItems}
      todayDate={todayDate}
    />
  )
}

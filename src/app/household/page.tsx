import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { auth } from '@/lib/auth'
import {
  countAccountHoldingMembers,
  getHouseholdMembership,
  listHouseholdMembers,
} from '@/lib/household'
import { getQueryClient } from '@/lib/get-query-client'
import { Body, Heading } from '@/components/ui/typography'
import { Separator } from '@/components/ui/separator'
import { HouseholdSettingsForm } from './household/HouseholdSettingsForm'
import { LeaveHouseholdDialog } from './household/LeaveHouseholdDialog'
import { MemberList } from '@/components/household/MemberList'
import { MEMBERS_QUERY_KEY, type MembersResponse } from '@/components/household/members-query'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { REMINDER_WEEKDAYS, type ReminderWeekday } from '@/lib/weekly-reminder-schedule'

/** A stored weekday outside 1–7 reads as off rather than as a broken select. */
function toReminderWeekday(value: number | null): ReminderWeekday | null {
  return (REMINDER_WEEKDAYS as readonly number[]).includes(value ?? 0)
    ? (value as ReminderWeekday)
    : null
}

export default async function HouseholdPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect('/sign-in')
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    redirect('/')
  }

  // Prefetch the roster so the Members list is in the first HTML response
  // instead of behind a second client round trip (HON-780, after HON-770). A
  // failed prefetch is not dehydrated, so `MemberList` falls back to fetching
  // it itself; no retries here, since the default two would hold the render.
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({
    queryKey: MEMBERS_QUERY_KEY,
    retry: false,
    queryFn: async () => {
      const members = await listHouseholdMembers(membership.householdId)
      // Round-trip through JSON so the cached response has the wire shape the
      // client's `apiFetch` produces (dates as ISO strings, not `Date`).
      return JSON.parse(
        JSON.stringify({ householdId: membership.householdId, members }),
      ) as MembersResponse
    },
  })

  const t = await getTranslations('household')
  const isOwner = membership.role === 'owner'
  const { household } = membership
  // Only an owner's leave turns on it: with another account holder they
  // cannot leave, and alone they delete the household (HON-1133). Members
  // without an account do not count, as for account deletion (HON-881).
  const accountMemberCount = isOwner ? await countAccountHoldingMembers(membership.householdId) : 1

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="flex w-full flex-col gap-6 px-4 py-8">
        <div className="flex flex-col gap-1.5">
          <Heading variant="h4" as="h1">
            {t('pageTitle')}
          </Heading>
          {/* One notice for the whole page: a member can edit only their own
              row and none of the settings (HON-960). */}
          {!isOwner && <Body variant="muted">{t('settings.ownerOnlyNotice')}</Body>}
        </div>

        {/* Members first, then the settings, in one form column: the member
            list is short and sits above a form, so the page keeps one right
            edge and each portion stays near its name (HON-1020, reversing the
            full-width list of HON-960). */}
        <div className="flex max-w-2xl flex-col gap-10">
          <MemberList isOwner={isOwner} currentMemberId={membership.id} />

          <HouseholdSettingsForm
            household={{
              id: household.id,
              name: household.name,
              timezone: household.timezone,
              locale: resolveHouseholdLocale(household),
            }}
            preferences={
              household.preferences
                ? {
                    dietaryType: household.preferences.dietaryType,
                    allergensToAvoid: household.preferences.allergensToAvoid,
                    restrictions: household.preferences.restrictions,
                    excludedIngredients: household.preferences.excludedIngredients,
                    weekdayMealTypes: household.preferences.weekdayMealTypes,
                    weekendMealTypes: household.preferences.weekendMealTypes,
                  }
                : null
            }
            isOwner={isOwner}
            reminderWeekday={toReminderWeekday(membership.reminderWeekday)}
            reminderConfirmed={membership.reminderConfirmedAt !== null}
          />

          {/* Last, in the style of the profile page's Danger zone (HON-1133). */}
          <div className="flex flex-col gap-6">
            <Separator />
            <div className="flex flex-col gap-3">
              <Heading variant="section" as="h2">
                {t('leave.heading')}
              </Heading>
              <LeaveHouseholdDialog
                householdName={household.name}
                isOwner={isOwner}
                accountMemberCount={accountMemberCount}
              />
            </div>
          </div>
        </div>
      </div>
    </HydrationBoundary>
  )
}

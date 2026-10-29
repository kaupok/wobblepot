import { Separator } from '@/components/ui/separator'
import { Body, Heading } from '@/components/ui/typography'
import { countAccountHoldingMembers } from '@/lib/household'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'

import { householdTabMetadata, requireHouseholdMember } from '../household-member'
import { HouseholdDetailsForm } from './HouseholdDetailsForm'
import { LeaveHouseholdDialog } from './LeaveHouseholdDialog'

export function generateMetadata() {
  return householdTabMetadata('settings')
}

/**
 * Household → Settings (HON-1257): the household's name, timezone and
 * language, then Leave household as the danger zone.
 */
export default async function HouseholdSettingsPage() {
  const { membership, t, isOwner } = await requireHouseholdMember()
  const { household } = membership
  // Only an owner's leave turns on it: with another account holder they
  // cannot leave, and alone they delete the household (HON-1133). Members
  // without an account do not count, as for account deletion (HON-881).
  const accountMemberCount = isOwner ? await countAccountHoldingMembers(membership.householdId) : 1

  return (
    <div className="flex flex-col gap-10">
      {/* The details route is owner-only, so a member reads why the form is
          locked (HON-960). Leave stays open to everyone. */}
      {!isOwner && <Body variant="muted">{t('settings.ownerOnlyNotice')}</Body>}
      <HouseholdDetailsForm
        household={{
          id: household.id,
          name: household.name,
          timezone: household.timezone,
          locale: resolveHouseholdLocale(household),
        }}
        isOwner={isOwner}
      />

      {/* Last, in the style of My account → Your data's Danger zone (HON-1133). */}
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
  )
}

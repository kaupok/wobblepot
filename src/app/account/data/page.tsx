import { countAccountHoldingMembers } from '@/lib/household'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { DeleteAccountDialog } from './DeleteAccountDialog'
import { accountTabMetadata, requireAccountMember } from '../account-member'

export function generateMetadata() {
  return accountTabMetadata('data')
}

/** My account → Your data: download, then delete the account (HON-1229). */
export default async function AccountDataPage() {
  const { session, membership, t } = await requireAccountMember()

  const isOwner = membership.role === 'owner'
  // Only an owner's dialog reads this: members with an account are the ones
  // that block deletion, and members without one are deleted with the
  // household (HON-881). Not `household._count.members`, which counts every
  // member row — the household size — and would block an owner whose other
  // members are all children added by name. Skipped for non-owners.
  const accountMemberCount = isOwner
    ? await countAccountHoldingMembers(membership.householdId)
    : undefined

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Heading variant="section" as="h2">
          {t('yourDataHeading')}
        </Heading>
        <Body variant="muted">{t('yourDataDescription')}</Body>
        <div>
          <Button asChild variant="outline">
            <a href="/api/auth/user/export" download>
              {t('downloadButton')}
            </a>
          </Button>
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <Heading variant="section" as="h2">
          {t('dangerHeading')}
        </Heading>
        <Body variant="muted">{t('dangerDescription')}</Body>
        <div>
          <DeleteAccountDialog
            userEmail={session.user.email}
            householdName={membership.household.name}
            isOwner={isOwner}
            accountMemberCount={accountMemberCount}
          />
        </div>
      </div>
    </div>
  )
}

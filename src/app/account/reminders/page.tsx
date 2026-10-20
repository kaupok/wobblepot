import { toReminderWeekday } from '@/lib/weekly-reminder-schedule'
import { WeeklyReminderForm } from './WeeklyReminderForm'
import { accountTabMetadata, requireAccountMember } from '../account-member'

export function generateMetadata() {
  return accountTabMetadata('reminders')
}

/**
 * My account → Reminders (HON-1256): the viewer's own weekly reminder. It
 * sits on the household membership row, but the consent is the person's, so
 * it is here and not among the owner's household settings.
 */
export default async function AccountRemindersPage() {
  const { membership } = await requireAccountMember()

  return (
    <WeeklyReminderForm
      weekday={toReminderWeekday(membership.reminderWeekday)}
      confirmed={membership.reminderConfirmedAt !== null}
      confirmLinkSent={membership.reminderConfirmToken !== null}
    />
  )
}

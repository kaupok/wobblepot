import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { reminderConfirmState, REMINDER_CONFIRM_TTL_DAYS } from '@/lib/weekly-reminder'
import { Card, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { ConfirmReminderForm } from './ConfirmReminderForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('reminders.confirm')
  // The URL carries a token, so it must never be indexed.
  return { title: t('metaTitle'), robots: { index: false, follow: false } }
}

interface ConfirmReminderPageProps {
  searchParams: Promise<{ token?: string | string[] }>
}

const householdLink = (chunks: ReactNode) => (
  <Link href="/household" className="text-foreground underline underline-offset-2">
    {chunks}
  </Link>
)

/**
 * `/reminders/confirm?token=…`: the link in the weekly reminder confirm email
 * (HON-1113). Public, so it works without a sign-in.
 *
 * Opening the page changes nothing; its button does. The email may have gone
 * to a stranger's address (sign-up does not verify it), and mail scanners
 * open every link in an email, so a GET that confirmed would let a scanner
 * consent for the stranger. The page reads the link's state: a link waiting
 * for its button, one already confirmed, or one that is old or unknown or
 * whose reminder is off, which reads as expired.
 */
export default async function ConfirmReminderPage({ searchParams }: ConfirmReminderPageProps) {
  const { token } = await searchParams
  const validToken = typeof token === 'string' && token ? token : undefined
  const [state, t] = await Promise.all([
    reminderConfirmState(validToken),
    getTranslations('reminders.confirm'),
  ])

  if (state === 'pending' && validToken) {
    return (
      <div className="min-h-screen-below-header grid place-items-center p-4">
        <ConfirmReminderForm token={validToken} ttlDays={REMINDER_CONFIRM_TTL_DAYS} />
      </div>
    )
  }

  const confirmed = state === 'confirmed'
  return (
    <div className="min-h-screen-below-header grid place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Heading as="h1" variant="h4">
            {confirmed ? t('confirmedTitle') : t('expiredTitle')}
          </Heading>
          <Body variant="muted">
            {confirmed
              ? t.rich('confirmedBody', { link: householdLink })
              : t.rich('expiredBody', { days: REMINDER_CONFIRM_TTL_DAYS, link: householdLink })}
          </Body>
        </CardHeader>
      </Card>
    </div>
  )
}

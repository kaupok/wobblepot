import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { confirmReminderToken, REMINDER_CONFIRM_TTL_DAYS } from '@/lib/weekly-reminder'
import { Card, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'

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
 * (HON-1113). Public, so it works without a sign-in. Opening the page
 * confirms, as the waitlist link does: the email went only to the address
 * being proved, and a mail scanner that opens it first leaves the link
 * reading as confirmed. An old or unknown token, or a reminder that is off,
 * reads as expired.
 */
export default async function ConfirmReminderPage({ searchParams }: ConfirmReminderPageProps) {
  const { token } = await searchParams
  const [confirmed, t] = await Promise.all([
    confirmReminderToken(typeof token === 'string' ? token : undefined),
    getTranslations('reminders.confirm'),
  ])

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

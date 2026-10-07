import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Card, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { StopRemindersForm } from './StopRemindersForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('reminders.stop')
  // The URL carries a token, so it must never be indexed.
  return { title: t('metaTitle'), robots: { index: false, follow: false } }
}

interface StopRemindersPageProps {
  searchParams: Promise<{ token?: string | string[] }>
}

/**
 * `/reminders/stop?token=…`: the stop link in the weekly planning reminder
 * email (HON-1084). Public, so it works without a sign-in, and the locale
 * comes from the request as on the other public pages.
 *
 * Opening the page changes nothing; its button does. Mail scanners open every
 * link in an email, so a bare GET that stopped the reminders would stop them
 * before the person ever saw the email.
 */
export default async function StopRemindersPage({ searchParams }: StopRemindersPageProps) {
  const { token } = await searchParams
  if (typeof token === 'string' && token) {
    return (
      <div className="min-h-screen-below-header grid place-items-center p-4">
        <StopRemindersForm token={token} />
      </div>
    )
  }

  const t = await getTranslations('reminders.stop')
  return (
    <div className="min-h-screen-below-header grid place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Heading as="h1" variant="h4">
            {t('title')}
          </Heading>
          <Body variant="muted">
            {t.rich('incompleteLink', {
              link: (chunks) => (
                <Link href="/household" className="text-foreground underline underline-offset-2">
                  {chunks}
                </Link>
              ),
            })}
          </Body>
        </CardHeader>
      </Card>
    </div>
  )
}

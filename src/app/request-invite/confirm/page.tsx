import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { confirmWaitlistToken } from '@/lib/waitlist'
import { Button } from '@/components/ui/button'
import { Card, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.requestInvite')
  // The URL carries a token, so it must never be indexed.
  return { title: t('confirmMetaTitle'), robots: { index: false, follow: false } }
}

interface ConfirmPageProps {
  searchParams: Promise<{ token?: string | string[] }>
}

/**
 * `/request-invite/confirm?token=…`: the double opt-in link from the
 * confirmation email (HON-846). A token issued within the last 7 days confirms
 * the request, and opening it again still reads as confirmed (a mail scanner
 * may have opened it first). A replaced or older token, or none, reads as
 * expired.
 */
export default async function ConfirmInviteRequestPage({ searchParams }: ConfirmPageProps) {
  const { token } = await searchParams
  const [confirmed, t] = await Promise.all([
    confirmWaitlistToken(typeof token === 'string' ? token : undefined),
    getTranslations('auth.requestInvite'),
  ])

  return (
    <div className="min-h-screen-below-header grid place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Heading as="h1" variant="h4">
            {confirmed ? t('confirmedTitle') : t('expiredTitle')}
          </Heading>
          {confirmed && <Body variant="muted">{t('confirmedBody')}</Body>}
        </CardHeader>
        {!confirmed && (
          <CardFooter>
            <Button asChild>
              <Link href="/request-invite">{t('askAgain')}</Link>
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  )
}

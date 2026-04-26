import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('errors.notFound')
  return { title: t('metaTitle') }
}

export default async function NotFound() {
  const t = await getTranslations('errors.notFound')
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 p-8">
      <div className="max-w-md text-center">
        <div className="flex flex-col gap-3">
          <Heading variant="h2">{t('title')}</Heading>
          <Body>{t('body')}</Body>
        </div>
        <div className="mt-6">
          <Button asChild>
            <Link href="/">{t('action')}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

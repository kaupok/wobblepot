import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { ResetPasswordForm } from './ResetPasswordForm'
import { Card, CardContent } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.resetPassword')
  return { title: t('metaTitle') }
}

export default async function ResetPasswordPage() {
  const t = await getTranslations('common')
  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <Suspense fallback={<LoadingFallback message={t('loading')} />}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  )
}

function LoadingFallback({ message }: { message: string }) {
  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex items-center justify-center p-8">
        <Body variant="muted">{message}</Body>
      </CardContent>
    </Card>
  )
}

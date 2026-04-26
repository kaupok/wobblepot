import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { ForgotPasswordForm } from './ForgotPasswordForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.forgotPassword')
  return { title: t('metaTitle') }
}

export default function ForgotPasswordPage() {
  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <ForgotPasswordForm />
    </div>
  )
}

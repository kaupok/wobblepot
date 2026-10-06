import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getServerFlag } from '@/lib/feature-flags'
import { RequestInviteForm } from './RequestInviteForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.requestInvite')
  return { title: t('metaTitle') }
}

/**
 * `/request-invite`: a visitor without an invite code leaves an email and
 * confirms it from the emailed link (HON-846). Public, so the locale comes from
 * Accept-Language. With `invite_code_required` off there is nothing to wait
 * for, so the page sends the visitor to sign-up.
 */
export default async function RequestInvitePage() {
  const inviteRequired = await getServerFlag('invite_code_required', 'anonymous')
  if (!inviteRequired) redirect('/sign-up')

  return (
    <div className="min-h-screen-below-header grid place-items-center p-4">
      <RequestInviteForm />
    </div>
  )
}

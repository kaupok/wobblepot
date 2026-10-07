import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getServerFlag } from '@/lib/feature-flags'
import { RequestInviteForm } from './RequestInviteForm'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.requestInvite')
  return { title: t('metaTitle') }
}

interface RequestInvitePageProps {
  searchParams: Promise<{ ref?: string | string[] }>
}

/**
 * `/request-invite`: a visitor without an invite code leaves an email and
 * confirms it from the emailed link (HON-846). Public, so the locale comes from
 * Accept-Language. With `invite_code_required` off there is nothing to wait
 * for, so the page sends the visitor to sign-up.
 *
 * `?ref=` names the link the visitor followed (HON-1089). The form passes it
 * on, and `POST /api/waitlist` stores it as the request's source when it is a
 * valid slug. A repeated `ref` is dropped here.
 */
export default async function RequestInvitePage({ searchParams }: RequestInvitePageProps) {
  const inviteRequired = await getServerFlag('invite_code_required', 'anonymous')
  if (!inviteRequired) redirect('/sign-up')

  const { ref } = await searchParams

  return (
    <div className="min-h-screen-below-header grid place-items-center p-4">
      <RequestInviteForm source={typeof ref === 'string' ? ref : undefined} />
    </div>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/auth-helpers'
import { listSignupCodes } from '@/lib/signup-codes'
import { Heading, Body } from '@/components/ui/typography'
import { SignupCodesClient } from './SignupCodesClient'

export async function generateMetadata(): Promise<Metadata> {
  // Metadata resolves independently of the layout's and page's gates, so it
  // needs its own: without it a non-admin gets the 404 body under this page's
  // title (HON-830). `notFound()` here resolves the not-found metadata instead.
  if (!isAdmin(await getSession())) notFound()

  return {
    title: 'Signup codes',
    robots: { index: false, follow: false },
  }
}

export default async function AdminSignupCodesPage() {
  // Deduped with the `/admin` layout's lookup via `cache()` in `@/lib/session`.
  const session = await getSession()
  // Return 404 (not 403) so the route does not advertise its existence.
  if (!isAdmin(session)) notFound()

  const initialCodes = await listSignupCodes()

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <Heading variant="h2">Signup codes</Heading>
        <Body variant="muted">
          Single-use invite codes for the private beta. Mint a code to share, revoke unused codes if
          you change your mind.
        </Body>
        <Body variant="small">
          <Link href="/admin/waitlist" className="underline">
            Waitlist
          </Link>
        </Body>
      </div>
      <SignupCodesClient initialCodes={initialCodes} />
    </div>
  )
}

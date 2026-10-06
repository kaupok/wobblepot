import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/auth-helpers'
import { listConfirmedWaitlistRequests } from '@/lib/waitlist'
import { Heading, Body } from '@/components/ui/typography'
import { WaitlistClient } from './WaitlistClient'

// Admin pages are English-only (decided 2026-10-06), so the copy here is
// inline rather than in the catalogs.
export async function generateMetadata(): Promise<Metadata> {
  // Metadata resolves independently of the layout's and page's gates, so it
  // needs its own (HON-830). `notFound()` here resolves the not-found metadata.
  if (!isAdmin(await getSession())) notFound()

  return {
    title: 'Waitlist',
    robots: { index: false, follow: false },
  }
}

export default async function AdminWaitlistPage() {
  // Deduped with the `/admin` layout's lookup via `cache()` in `@/lib/session`.
  const session = await getSession()
  // Return 404 (not 403) so the route does not advertise its existence.
  if (!isAdmin(session)) notFound()

  const initialRequests = await listConfirmedWaitlistRequests()

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <Heading variant="h2">Waitlist</Heading>
        <Body variant="muted">
          People who asked for an invite and confirmed their email. Send invite emails them a new
          code. Remove deletes the request, for example when someone withdraws.
        </Body>
        <Body variant="small">
          <Link href="/admin/signup-codes" className="underline">
            Signup codes
          </Link>
        </Body>
      </div>
      <WaitlistClient initialRequests={initialRequests} />
    </div>
  )
}

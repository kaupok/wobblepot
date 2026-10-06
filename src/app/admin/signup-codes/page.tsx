import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { Heading, Body } from '@/components/ui/typography'
import { SignupCodesClient, type SignupCodeRow } from './SignupCodesClient'

export async function generateMetadata(): Promise<Metadata> {
  // Metadata resolves independently of the layout's and page's gates, so it
  // needs its own: without it a non-admin gets the 404 body under this page's
  // title (HON-830). `notFound()` here resolves the not-found metadata instead.
  if (!isAdmin(await getSession())) notFound()

  const t = await getTranslations('meta.admin.signupCodes')
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  }
}

export default async function AdminSignupCodesPage() {
  // Deduped with the `/admin` layout's lookup via `cache()` in `@/lib/session`.
  const session = await getSession()
  // Return 404 (not 403) so the route does not advertise its existence.
  if (!isAdmin(session)) notFound()

  const codes = await prisma.signupCode.findMany({
    take: 100,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      code: true,
      createdAt: true,
      usedAt: true,
      expiresAt: true,
      note: true,
      usedBy: { select: { email: true } },
    },
  })

  // Serialise dates for the client component (Prisma returns Date objects;
  // useQuery / JSON would otherwise drop the prototype).
  const initialCodes: SignupCodeRow[] = codes.map((c) => ({
    id: c.id,
    code: c.code,
    createdAt: c.createdAt.toISOString(),
    usedAt: c.usedAt ? c.usedAt.toISOString() : null,
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    note: c.note,
    usedByEmail: c.usedBy?.email ?? null,
  }))

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

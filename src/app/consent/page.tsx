import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/session'
import { loadConsentRequest } from '@/lib/mcp/consent-request'
import { ConsentCard } from './ConsentCard'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.connect')
  return { title: t('metaTitle') }
}

interface ConsentPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function toSearchParams(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => search.append(key, v))
    else if (value !== undefined) search.append(key, value)
  }
  return search
}

/**
 * The consent step of an MCP client's OAuth authorization (HON-1150). The
 * provider's authorize endpoint sends a signed-in user here with a signed
 * query; Allow or Deny returns them to the client.
 */
export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const search = toSearchParams(await searchParams)

  // `getSession` is `cache()`-wrapped, so this reuses the root layout's lookup.
  const session = await getSession()
  if (!session) {
    // The proxy already sends a cookie-less request to sign-in; this covers a
    // stale cookie. The query rides along in `returnUrl`, so the signed
    // request is still on the URL when the user comes back.
    const query = search.toString()
    redirect(`/sign-in?returnUrl=${encodeURIComponent(query ? `/consent?${query}` : '/consent')}`)
  }

  const request = await loadConsentRequest(search, session.user.id)

  return (
    <div className="min-h-screen-below-header grid place-items-center p-4">
      {request.status === 'ready' ? (
        <ConsentCard
          status="ready"
          clientName={request.clientName}
          householdName={request.householdName}
          scopes={request.scopes}
        />
      ) : (
        <ConsentCard status="invalid" />
      )}
    </div>
  )
}

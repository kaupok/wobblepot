'use client'

import { useEffect, useState, Suspense, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
// No `@posthog/react`: its entry imports `posthog-js` statically, which put
// the whole SDK in the root layout's initial JS for every visitor, consent or
// not (HON-999). `posthog-js` is reached only through the dynamic import below.
import type { PostHog } from 'posthog-js'
import { clientEnv } from '@/lib/env'
import { useAnalyticsConsent } from '@/components/ConsentProvider'
import { POSTHOG_INIT_OPTIONS } from '@/lib/posthog-init-options'
import { markPostHogLoaded } from '@/lib/posthog-client-state'
import type { BootstrapData } from '@/lib/feature-flags'

interface PostHogProviderProps {
  children: ReactNode
  userId?: string
  householdId?: string | null
  /**
   * Server-evaluated feature-flag bootstrap. When present, PostHog returns the
   * bootstrapped values synchronously for `isFeatureEnabled` calls before any
   * `/decide` round-trip — eliminating the flash-of-wrong-variant on hydration.
   */
  bootstrap?: BootstrapData
}

type IdleSchedule = (cb: () => void) => number
type IdleCancel = (handle: number) => void

function scheduleIdle(cb: () => void): { cancel: () => void } {
  const w = window as typeof window & {
    requestIdleCallback?: IdleSchedule
    cancelIdleCallback?: IdleCancel
  }
  if (typeof w.requestIdleCallback === 'function') {
    const handle = w.requestIdleCallback(cb)
    return {
      cancel: () => w.cancelIdleCallback?.(handle),
    }
  }
  const handle = window.setTimeout(cb, 0)
  return { cancel: () => window.clearTimeout(handle) }
}

export function PostHogProvider({
  children,
  userId,
  householdId,
  bootstrap,
}: PostHogProviderProps) {
  const { granted } = useAnalyticsConsent()
  const [client, setClient] = useState<PostHog | null>(null)

  // Lazy-load and initialise posthog-js only after consent is granted.
  // `opt_out_capturing_by_default` is a post-init event gate — it does not
  // prevent `posthog.init()` from fetching config.js, surveys.js, and
  // web-vitals.js at init time (through `/ingest`, which next.config.ts
  // rewrites to PostHog EU — HON-985). Those fetches are
  // tracking-without-consent under EDPB/AKI guidance, so the only compliant
  // position is to skip init entirely until the user opts in.
  // The host check stays: an unset NEXT_PUBLIC_POSTHOG_HOST also means no
  // rewrite exists, so `/ingest` would 404.
  useEffect(() => {
    if (!clientEnv.NEXT_PUBLIC_POSTHOG_KEY || !clientEnv.NEXT_PUBLIC_POSTHOG_HOST) return
    if (granted !== true) return
    if (client) return

    let cancelled = false
    const schedule = scheduleIdle(async () => {
      const { default: posthog } = await import('posthog-js')
      if (cancelled) return
      posthog.init(clientEnv.NEXT_PUBLIC_POSTHOG_KEY as string, {
        ...POSTHOG_INIT_OPTIONS,
        // Conditional spread keeps the option absent (rather than `undefined`)
        // so PostHog's default behaviour applies when no bootstrap is provided.
        ...(bootstrap ? { bootstrap } : {}),
      })
      markPostHogLoaded()
      setClient(posthog)
    })

    return () => {
      cancelled = true
      schedule.cancel()
    }
  }, [client, granted, bootstrap])

  // Mirror consent state to PostHog's opt-in/out. posthog-js clears its own
  // ph_* cookies when opt_out_capturing() runs, so we don't need a manual
  // cookie sweep here.
  // The client is set on every document load after consent, and each
  // opt_in_capturing() call sends a billable `$opt_in` event. So opt in only to
  // undo an opt-out (a withdraw, then a grant), and without the event.
  useEffect(() => {
    if (!client) return
    if (granted === true) {
      if (client.has_opted_out_capturing()) {
        client.opt_in_capturing({ captureEventName: false })
      }
    } else if (granted === false) {
      client.opt_out_capturing()
    }
  }, [client, granted])

  // Identify once PostHog is loaded, consent is granted, and a session exists.
  // Household id is the only custom property we pass — email / name / free
  // text are excluded by the universal PII policy (HON-474 Decision 10).
  //
  // A browser still identified as a different user (a session that expired
  // without sign-out, so `reset()` never ran) is reset first: `identify` keeps
  // the previous user's super properties, including the `first_*_at` markers
  // that `track()` reads for `is_first` (HON-991). The previous user is read
  // from `$user_id`, which `identify` sets and `reset()` clears: on a full page
  // load the flag bootstrap has already rewritten `distinct_id` to this user
  // and `$user_state` to anonymous, so those two cannot tell a switch apart.
  // The `$user_state` branch covers persistence written before `$user_id`.
  useEffect(() => {
    if (!client) return
    if (granted !== true) return
    if (!userId) return
    const previousUserId: unknown =
      client.get_property('$user_id') ??
      (client.get_property('$user_state') === 'identified' ? client.get_distinct_id() : undefined)
    if (previousUserId && previousUserId !== userId) {
      client.reset()
    }
    client.identify(userId, householdId ? { household_id: householdId } : undefined)
  }, [client, granted, userId, householdId])

  if (!client) return <>{children}</>

  return (
    <>
      <SuspendedPostHogPageView client={client} />
      {children}
    </>
  )
}

function SuspendedPostHogPageView({ client }: { client: PostHog }) {
  // useSearchParams suspends during SSR prerender; isolating the pageview
  // effect behind <Suspense> keeps the rest of the tree prerenderable.
  return (
    <Suspense fallback={null}>
      <PostHogPageView client={client} />
    </Suspense>
  )
}

function PostHogPageView({ client }: { client: PostHog }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!pathname) return
    const query = searchParams?.toString()
    const url = window.location.origin + pathname + (query ? `?${query}` : '')
    client.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams, client])

  return null
}

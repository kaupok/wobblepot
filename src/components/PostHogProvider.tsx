'use client'

import { useEffect, useState, Suspense, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { PostHogProvider as PHProvider, usePostHog } from '@posthog/react'
import type { PostHog } from 'posthog-js'
import { clientEnv } from '@/lib/env'
import { useAnalyticsConsent } from '@/components/ConsentProvider'

interface PostHogProviderProps {
  children: ReactNode
  userId?: string
  householdId?: string | null
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

export function PostHogProvider({ children, userId, householdId }: PostHogProviderProps) {
  const { granted } = useAnalyticsConsent()
  const [client, setClient] = useState<PostHog | null>(null)

  // Lazy-load and initialise posthog-js only after consent is granted.
  // `opt_out_capturing_by_default` is a post-init event gate — it does not
  // prevent `posthog.init()` from fetching config.js, surveys.js, and
  // web-vitals.js from eu-assets.i.posthog.com at init time. Those fetches
  // are tracking-without-consent under EDPB/AKI guidance, so the only
  // compliant position is to skip init entirely until the user opts in.
  useEffect(() => {
    if (!clientEnv.NEXT_PUBLIC_POSTHOG_KEY || !clientEnv.NEXT_PUBLIC_POSTHOG_HOST) return
    if (granted !== true) return
    if (client) return

    let cancelled = false
    const schedule = scheduleIdle(async () => {
      const { default: posthog } = await import('posthog-js')
      if (cancelled) return
      posthog.init(clientEnv.NEXT_PUBLIC_POSTHOG_KEY as string, {
        api_host: clientEnv.NEXT_PUBLIC_POSTHOG_HOST as string,
        person_profiles: 'identified_only',
        capture_pageview: false,
        disable_session_recording: true,
        defaults: '2026-01-30',
      })
      setClient(posthog)
    })

    return () => {
      cancelled = true
      schedule.cancel()
    }
  }, [client, granted])

  // Mirror consent state to PostHog's opt-in/out. posthog-js clears its own
  // ph_* cookies when opt_out_capturing() runs, so we don't need a manual
  // cookie sweep here.
  useEffect(() => {
    if (!client) return
    if (granted === true) {
      client.opt_in_capturing()
    } else if (granted === false) {
      client.opt_out_capturing()
    }
  }, [client, granted])

  // Identify once PostHog is loaded, consent is granted, and a session exists.
  // Household id is the only custom property we pass — email / name / free
  // text are excluded by the universal PII policy (HON-474 Decision 10).
  useEffect(() => {
    if (!client) return
    if (granted !== true) return
    if (!userId) return
    client.identify(userId, householdId ? { household_id: householdId } : undefined)
  }, [client, granted, userId, householdId])

  if (!client) return <>{children}</>

  return (
    <PHProvider client={client}>
      <SuspendedPostHogPageView />
      {children}
    </PHProvider>
  )
}

function SuspendedPostHogPageView() {
  // useSearchParams suspends during SSR prerender; isolating the pageview
  // effect behind <Suspense> keeps the rest of the tree prerenderable.
  return (
    <Suspense fallback={null}>
      <PostHogPageView />
    </Suspense>
  )
}

function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const posthog = usePostHog()

  useEffect(() => {
    if (!pathname || !posthog) return
    const query = searchParams?.toString()
    const url = window.location.origin + pathname + (query ? `?${query}` : '')
    posthog.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams, posthog])

  return null
}

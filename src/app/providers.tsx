'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { getQueryClient } from '@/lib/get-query-client'
import { AiUsageToast } from '@/components/AiUsageToast'
import { PostHogProvider } from '@/components/PostHogProvider'
import type { BootstrapData } from '@/lib/feature-flags'

interface ProvidersProps {
  children: React.ReactNode
  /**
   * When true, mount AiUsageToast (which polls /api/households/me/ai-usage).
   * Gating on the server-resolved session keeps anonymous traffic — sign-in,
   * sign-up, marketing pages — from issuing a guaranteed-401 backend call on
   * every render.
   */
  isAuthenticated?: boolean
  /** Authenticated user id, used by PostHogProvider to call identify(). */
  userId?: string
  /** Household id of the authenticated user, attached to the PostHog person. */
  householdId?: string | null
  /**
   * Server-evaluated feature-flag bootstrap, forwarded to PostHogProvider so
   * `posthog.isFeatureEnabled` returns the correct value synchronously on the
   * first client render (no flash of wrong variant).
   */
  bootstrap?: BootstrapData
}

export default function Providers({
  children,
  isAuthenticated = false,
  userId,
  householdId,
  bootstrap,
}: ProvidersProps) {
  const queryClient = getQueryClient()
  return (
    <QueryClientProvider client={queryClient}>
      <PostHogProvider userId={userId} householdId={householdId} bootstrap={bootstrap}>
        {isAuthenticated ? <AiUsageToast /> : null}
        {children}
      </PostHogProvider>
    </QueryClientProvider>
  )
}

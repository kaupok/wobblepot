'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { getQueryClient } from '@/lib/get-query-client'
import { AiUsageToast } from '@/components/AiUsageToast'
import { PostHogProvider } from '@/components/PostHogProvider'

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
}

export default function Providers({
  children,
  isAuthenticated = false,
  userId,
  householdId,
}: ProvidersProps) {
  const queryClient = getQueryClient()
  return (
    <QueryClientProvider client={queryClient}>
      <PostHogProvider userId={userId} householdId={householdId}>
        {isAuthenticated ? <AiUsageToast /> : null}
        {children}
      </PostHogProvider>
    </QueryClientProvider>
  )
}

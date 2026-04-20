'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { getQueryClient } from '@/lib/get-query-client'
import { AiUsageToast } from '@/components/AiUsageToast'

interface ProvidersProps {
  children: React.ReactNode
  /**
   * When true, mount AiUsageToast (which polls /api/households/me/ai-usage).
   * Gating on the server-resolved session keeps anonymous traffic — sign-in,
   * sign-up, marketing pages — from issuing a guaranteed-401 backend call on
   * every render.
   */
  isAuthenticated?: boolean
}

export default function Providers({ children, isAuthenticated = false }: ProvidersProps) {
  const queryClient = getQueryClient()
  return (
    <QueryClientProvider client={queryClient}>
      {isAuthenticated ? <AiUsageToast /> : null}
      {children}
    </QueryClientProvider>
  )
}

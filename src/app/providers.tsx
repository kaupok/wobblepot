'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { getQueryClient } from '@/lib/get-query-client'
import { AiUsageToast } from '@/components/AiUsageToast'

export default function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient()
  return (
    <QueryClientProvider client={queryClient}>
      <AiUsageToast />
      {children}
    </QueryClientProvider>
  )
}

'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'

interface AiUsageResponse {
  spendUsd: number
  capUsd: number
  percentage: number
  resetAt: string
}

const SESSION_STORAGE_KEY = 'ai-usage-toast-shown'

/**
 * Background poller that surfaces a single warning toast when the household's
 * AI spend reaches 80% of its monthly cap. The toast fires once per browser
 * session per calendar month (gated via sessionStorage) so page reloads don't
 * spam the user.
 *
 * Renders nothing — the component exists purely for its side effect.
 */
export function AiUsageToast() {
  const { data } = useQuery<AiUsageResponse>({
    queryKey: ['ai-usage'],
    queryFn: () => apiFetch<AiUsageResponse>('/api/households/me/ai-usage'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  useEffect(() => {
    if (!data) return
    if (data.percentage < 80 || data.percentage >= 100) return

    if (typeof window === 'undefined') return

    const monthKey = data.resetAt.slice(0, 7)
    const alreadyShown = window.sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (alreadyShown === monthKey) return

    window.sessionStorage.setItem(SESSION_STORAGE_KEY, monthKey)
    toast.warning(`AI usage is at ${Math.round(data.percentage)}% of your monthly cap.`)
  }, [data])

  return null
}

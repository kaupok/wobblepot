'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('common')
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
    // Clamp to 99 so a household at e.g. 99.6% (below cap, AI routes still
    // serving) never reads a misleading "100%" — the ≥100 over-cap state has
    // its own handling (429 from AI routes) and is excluded by the gate above.
    const percentage = Math.min(99, Math.round(data.percentage))
    toast.warning(t('aiUsageCapWarning', { percentage }))
  }, [data, t])

  return null
}

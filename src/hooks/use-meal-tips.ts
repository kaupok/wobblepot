'use client'

import { useState, useCallback } from 'react'
import type { StructuredTips } from '@/components/meal-plan/types'

interface UseMealTipsOptions {
  planId: string
  entryId: string
  initialTips?: StructuredTips | null
}

export function useMealTips({ planId, entryId, initialTips = null }: UseMealTipsOptions) {
  const [tips, setTips] = useState<StructuredTips | null>(initialTips)
  const [isLoadingTips, setIsLoadingTips] = useState(false)
  const [tipsError, setTipsError] = useState<string | null>(null)
  const [isTipsExpanded, setIsTipsExpanded] = useState(false)

  const fetchTips = useCallback(async () => {
    setIsLoadingTips(true)
    setTipsError(null)
    setIsTipsExpanded(true)

    const url = `/api/meal-plans/${planId}/entries/${entryId}/preparation-tips`

    try {
      let response = await fetch(url, { method: 'POST' })

      // Auto-retry once after 2s for retryable server errors
      if (!response.ok && (response.status >= 500 || response.status === 429)) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        response = await fetch(url, { method: 'POST' })
      }

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Couldn't generate tips")
      }

      const data = await response.json()
      setTips(data.tips)
    } catch (error) {
      setTipsError(error instanceof Error ? error.message : "Couldn't generate tips. Try again.")
    } finally {
      setIsLoadingTips(false)
    }
  }, [planId, entryId])

  const handleHowToPrepare = useCallback(() => {
    if (tips) {
      setIsTipsExpanded((prev) => !prev)
    } else {
      fetchTips()
    }
  }, [tips, fetchTips])

  const hideTips = useCallback(() => {
    setIsTipsExpanded(false)
  }, [])

  return {
    tips,
    isLoadingTips,
    tipsError,
    isTipsExpanded,
    fetchTips,
    handleHowToPrepare,
    hideTips,
    setTips,
    setIsTipsExpanded,
    setTipsError,
  }
}

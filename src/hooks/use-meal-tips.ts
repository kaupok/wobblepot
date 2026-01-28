'use client'

import { useState, useCallback } from 'react'

interface UseMealTipsOptions {
  planId: string
  entryId: string
  initialTips?: string | null
}

export function useMealTips({ planId, entryId, initialTips = null }: UseMealTipsOptions) {
  const [tips, setTips] = useState<string | null>(initialTips)
  const [isLoadingTips, setIsLoadingTips] = useState(false)
  const [tipsError, setTipsError] = useState<string | null>(null)
  const [isTipsExpanded, setIsTipsExpanded] = useState(false)

  const fetchTips = useCallback(async () => {
    setIsLoadingTips(true)
    setTipsError(null)
    setIsTipsExpanded(true)

    try {
      const response = await fetch(
        `/api/meal-plans/${planId}/entries/${entryId}/preparation-tips`,
        {
          method: 'POST',
        },
      )

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

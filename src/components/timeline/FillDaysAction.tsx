'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GeneratingOverlay } from '@/components/meal-plan/GeneratingOverlay'
import { useDropPlanSuggestions } from '@/hooks/use-drop-plan-suggestions'
import { computeEndDate } from '@/lib/meal-planning/day-picker'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { formatDateRange } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import { track } from '@/lib/analytics'

/**
 * How long the client waits before giving up on `/api/meal-plans/generate`.
 *
 * Must stay *above* that route's `maxDuration` of 60s (HON-694). It used to be
 * 45s, which pre-empted the server: a generation that ran past 45s was thrown
 * away client-side even though the household had already been billed for it,
 * and the server's own 504 never reached the user. Waiting past the platform
 * ceiling means the request always resolves — with the plan, or with the
 * mapped 504 handled below.
 */
const CLIENT_TIMEOUT_MS = 65000

const DAY_OPTION_VALUES = ['3', '5', '7', '14'] as const

interface FillDaysActionProps {
  planId: string
  startDate: string // YYYY-MM-DD, first day of the fill range
}

export function FillDaysAction({ planId, startDate }: FillDaysActionProps) {
  const router = useRouter()
  const dropSuggestionCache = useDropPlanSuggestions(planId)
  const locale = useLocale() as Locale
  const tFill = useTranslations('meal-plan.fillDays')
  const tErrors = useTranslations('meal-plan.errors')
  const [days, setDays] = useState('7')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dateRangeLabel = useMemo(() => {
    const start = parseLocalDate(startDate)
    const endExclusive = parseLocalDate(computeEndDate(startDate, Number(days)))
    const endInclusive = new Date(endExclusive)
    endInclusive.setDate(endInclusive.getDate() - 1)
    return formatDateRange(start, endInclusive, locale)
  }, [startDate, days, locale])

  async function handleFill() {
    setIsGenerating(true)
    setError(null)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

    try {
      const endDate = computeEndDate(startDate, Number(days))
      const response = await fetch('/api/meal-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'fill-empty',
          planId,
          startDate,
          endDate,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        if (response.status === 429) {
          setError(tErrors('rateLimit'))
        } else if (response.status === 504) {
          // The server gave up on the generation within its own budget. Show
          // the localized timeout copy rather than the route's English message.
          setError(tErrors('generationTimeout'))
        } else {
          setError(data.message || tErrors('generationFailed'))
        }
        return
      }

      // Generate route returns `{ id: <planId>, ... }` (see GeneratePlanResult).
      const data = (await response.json().catch(() => ({}))) as { id?: string }
      if (data.id) {
        void track('meal_plan:plan_generated', { plan_id: data.id })
      }

      // A generation assigns meals across up to 14 days at once, which is the
      // largest possible change to the plan's `recentMealIds` — every cached
      // suggestion list on the page is stale (HON-682).
      dropSuggestionCache()
      router.refresh()
    } catch (err) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        setError(tErrors('generationTimeout'))
      } else {
        setError(tErrors('generic'))
      }
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <>
      {isGenerating && <GeneratingOverlay />}
      <div className="bg-muted/50 flex flex-col gap-2 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <Sparkles className="text-primary h-4 w-4 shrink-0" />
          <div className="flex flex-1 items-center gap-2">
            <Body variant="small" className="shrink-0">
              {tFill('label', { dateRange: dateRangeLabel })}
            </Body>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-25" aria-label={tFill('ariaDays')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTION_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tFill('dayOption', { count: Number(value) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleFill} disabled={isGenerating}>
            {isGenerating ? tFill('submitting') : tFill('submit')}
          </Button>
        </div>
        {error && (
          <Body variant="small" className="text-destructive">
            {error}
          </Body>
        )}
      </div>
    </>
  )
}

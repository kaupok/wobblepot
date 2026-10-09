'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
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
import { ApiError, apiFetch } from '@/lib/api'
import {
  MEAL_PLAN_GENERATE_ERROR_KEYS,
  mealPlanGenerateFallbackKey,
  translateErrorCode,
} from '@/lib/ai/error-codes'
import { FieldError } from '@/components/FieldError'

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
  /**
   * The fill succeeded. The refresh can unmount this bar, so the page moves
   * focus to the first filled day once that happens (HON-1139).
   */
  onFilled?: (startDate: string) => void
}

export function FillDaysAction({ planId, startDate, onFilled }: FillDaysActionProps) {
  const router = useRouter()
  const dropSuggestionCache = useDropPlanSuggestions(planId)
  const locale = useLocale() as Locale
  const tFill = useTranslations('meal-plan.fillDays')
  const tErrors = useTranslations('meal-plan.errors')
  const [days, setDays] = useState('7')
  const generateRef = useRef<HTMLButtonElement>(null)

  const dateRangeLabel = useMemo(() => {
    const start = parseLocalDate(startDate)
    const endExclusive = parseLocalDate(computeEndDate(startDate, Number(days)))
    const endInclusive = new Date(endExclusive)
    endInclusive.setDate(endInclusive.getDate() - 1)
    return formatDateRange(start, endInclusive, locale)
  }, [startDate, days, locale])

  const generateMutation = useMutation({
    mutationFn: async () => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

      const endDate = computeEndDate(startDate, Number(days))
      // Generate route returns `{ id: <planId>, ... }` (see GeneratePlanResult).
      return apiFetch<{ id?: string } | undefined>('/api/meal-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'fill-empty',
          planId,
          startDate,
          endDate,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId))
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) return
      // The route's `error` / `message` are English on every branch, so the
      // `code` picks the copy below and the prose is kept as a console
      // breadcrumb only (HON-725).
      const body = err.body as { error?: unknown; message?: unknown }
      console.error('[fill-days] request failed', {
        code: err.code,
        error: body.error,
        message: body.message,
      })
    },
    onSuccess: (data) => {
      if (data?.id) {
        void track('meal_plan:plan_generated', { plan_id: data.id })
      }

      // A generation assigns meals across up to 14 days at once, which is the
      // largest possible change to the plan's `recentMealIds` — every cached
      // suggestion list on the page is stale (HON-682).
      dropSuggestionCache()
      onFilled?.(startDate)
      router.refresh()
    },
  })
  const isGenerating = generateMutation.isPending
  const mutationError = generateMutation.error
  const error = !mutationError
    ? null
    : mutationError instanceof ApiError
      ? // A body with no known `code` — a platform 504, a proxy error page —
        // falls back on the status.
        tErrors(
          translateErrorCode(
            mutationError.code,
            MEAL_PLAN_GENERATE_ERROR_KEYS,
            mealPlanGenerateFallbackKey(mutationError.status),
          ),
        )
      : mutationError.name === 'AbortError'
        ? tErrors('generationTimeout')
        : tErrors('generic')

  function handleFill() {
    generateMutation.mutate()
  }

  return (
    <>
      {isGenerating && <GeneratingOverlay returnFocusRef={generateRef} />}
      <div className="bg-muted/50 flex flex-col gap-2 rounded-lg border p-4">
        {/* Below `sm` the label takes its own line and the select and Generate
            wrap under it; at 390px the three did not fit in one row and
            Generate covered the select (HON-1127). */}
        <div className="flex items-start gap-3 sm:items-center">
          <Sparkles className="text-primary h-4 w-4 shrink-0" />
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Body variant="small" className="shrink-0 basis-full sm:basis-auto">
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
            <Button
              ref={generateRef}
              className="sm:ml-auto"
              onClick={handleFill}
              disabled={isGenerating}
            >
              {isGenerating ? tFill('submitting') : tFill('submit')}
            </Button>
          </div>
        </div>
        {error && <FieldError>{error}</FieldError>}
      </div>
    </>
  )
}

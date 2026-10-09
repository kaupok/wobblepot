'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  getStartDateOptions,
  getDaysCountOptions,
  computeEndDate,
} from '@/lib/meal-planning/day-picker'
import type { Locale } from '@/lib/i18n/locales'
import type { DatesTranslator } from '@/lib/i18n/format-dates'
import { track } from '@/lib/analytics'
import { markFirstPlanGenerated } from '@/lib/first-plan-focus'
import { ApiError, apiFetch } from '@/lib/api'
import {
  MEAL_PLAN_GENERATE_ERROR_KEYS,
  mealPlanGenerateFallbackKey,
  translateErrorCode,
} from '@/lib/ai/error-codes'

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

/**
 * The household's first plan: the start-day and day-count choices, and the
 * request that generates it. Shared by the last onboarding step and Today's
 * `FirstTimeSetup`, which a household without a plan sees instead (a reload
 * on that step, or a member who joins before the first plan).
 */
export function useGenerateFirstPlan({ onGenerated }: { onGenerated: () => void }) {
  const locale = useLocale() as Locale
  const tDates = useTranslations('dates') as DatesTranslator
  const tErrors = useTranslations('meal-plan.errors')
  const startDateOptions = getStartDateOptions({ locale, t: tDates })
  const daysCountOptions = getDaysCountOptions()

  const [selectedDate, setSelectedDate] = useState(startDateOptions[0]?.date ?? '')
  const [daysCount, setDaysCount] = useState(7)

  const generateMutation = useMutation({
    mutationFn: async () => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

      const endDate = computeEndDate(selectedDate, daysCount)
      // Generate route returns `{ id: <planId>, ... }` (see GeneratePlanResult).
      return apiFetch<{ id?: string } | undefined>('/api/meal-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'generate',
          startDate: selectedDate,
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
      console.error('[first-plan] request failed', {
        code: err.code,
        error: body.error,
        message: body.message,
      })
    },
    onSuccess: (data) => {
      if (data?.id) {
        void track('meal_plan:plan_generated', { plan_id: data.id })
      }
      // Both callers leave the screen that holds Generate, so Today takes
      // focus instead (HON-1139).
      markFirstPlanGenerated()
      onGenerated()
    },
  })

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

  return {
    startDateOptions,
    daysCountOptions,
    selectedDate,
    setSelectedDate,
    daysCount,
    setDaysCount,
    generate: () => generateMutation.mutate(),
    isGenerating: generateMutation.isPending,
    error,
  }
}

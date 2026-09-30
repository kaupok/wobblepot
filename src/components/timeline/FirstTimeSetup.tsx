'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChoiceChips } from '@/components/ui/choice-chips'
import { Heading, Body } from '@/components/ui/typography'
import { GeneratingOverlay } from '@/components/meal-plan/GeneratingOverlay'
import {
  getStartDateOptions,
  getDaysCountOptions,
  computeEndDate,
} from '@/lib/meal-planning/day-picker'
import type { Locale } from '@/lib/i18n/locales'
import type { DatesTranslator } from '@/lib/i18n/format-dates'
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

interface FirstTimeSetupProps {
  userName?: string
}

export function FirstTimeSetup({ userName }: FirstTimeSetupProps) {
  const router = useRouter()
  const locale = useLocale() as Locale
  const tDates = useTranslations('dates') as DatesTranslator
  const tFirst = useTranslations('meal-plan.firstTime')
  const tErrors = useTranslations('meal-plan.errors')
  const tToday = useTranslations('today')
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
      console.error('[first-time-setup] request failed', {
        code: err.code,
        error: body.error,
        message: body.message,
      })
    },
    onSuccess: (data) => {
      if (data?.id) {
        void track('meal_plan:plan_generated', { plan_id: data.id })
      }
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

  function handleGenerate() {
    generateMutation.mutate()
  }

  return (
    <>
      {/* Today's page title, as in `TimelineView` (HON-815). Ahead of the
          overlay, whose own heading is an h2. */}
      <div className="sr-only">
        <Heading variant="h4" as="h1">
          {tToday('pageTitle')}
        </Heading>
      </div>
      {isGenerating && <GeneratingOverlay />}
      <div className="min-h-screen-below-header-gutters flex w-full items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-6 pt-8 pb-8">
            <div className="flex flex-col gap-2 text-center">
              <Heading variant="h4" as="h2">
                {userName ? tFirst('welcome', { userName }) : tFirst('welcomeNoName')}
              </Heading>
              <Body variant="muted">{tFirst('subhead')}</Body>
            </div>

            <div className="flex w-full flex-col gap-4">
              <section className="flex flex-col gap-2" aria-labelledby="start-from-heading">
                <Heading variant="section" as="h3" id="start-from-heading">
                  {tFirst('startFromLabel')}
                </Heading>
                <ChoiceChips
                  aria-labelledby="start-from-heading"
                  size="sm"
                  value={selectedDate}
                  onValueChange={setSelectedDate}
                  options={startDateOptions.map((option) => ({
                    value: option.date,
                    label: option.label,
                  }))}
                  disabled={isGenerating}
                />
              </section>

              <section className="flex flex-col gap-2" aria-labelledby="days-count-heading">
                <Heading variant="section" as="h3" id="days-count-heading">
                  {tFirst('daysCountLabel')}
                </Heading>
                <ChoiceChips
                  aria-labelledby="days-count-heading"
                  size="sm"
                  value={String(daysCount)}
                  onValueChange={(v) => setDaysCount(Number(v))}
                  options={daysCountOptions.map((option) => ({
                    value: String(option.value),
                    label: tFirst('dayOption', { count: option.value }),
                  }))}
                  disabled={isGenerating}
                />
              </section>
            </div>

            {error && <FieldError>{error}</FieldError>}

            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              size="lg"
              className="w-full md:w-auto md:self-start"
            >
              {isGenerating ? tFirst('submitting') : tFirst('submit')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

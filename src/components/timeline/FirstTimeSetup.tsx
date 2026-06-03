'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { ChefHat } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'
import { Label } from '@/components/ui/label'
import { GeneratingOverlay } from '@/components/meal-plan/GeneratingOverlay'
import {
  getStartDateOptions,
  getDaysCountOptions,
  computeEndDate,
} from '@/lib/meal-planning/day-picker'
import type { Locale } from '@/lib/i18n/locales'
import type { DatesTranslator } from '@/lib/i18n/format-dates'
import { track } from '@/lib/analytics'

const CLIENT_TIMEOUT_MS = 45000

interface FirstTimeSetupProps {
  userName?: string
}

export function FirstTimeSetup({ userName }: FirstTimeSetupProps) {
  const router = useRouter()
  const locale = useLocale() as Locale
  const tDates = useTranslations('dates') as DatesTranslator
  const tFirst = useTranslations('meal-plan.firstTime')
  const tErrors = useTranslations('meal-plan.errors')
  const startDateOptions = getStartDateOptions({ locale, t: tDates })
  const daysCountOptions = getDaysCountOptions()

  const [selectedDate, setSelectedDate] = useState(startDateOptions[0]?.date ?? '')
  const [daysCount, setDaysCount] = useState(7)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    setIsGenerating(true)
    setError(null)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

    try {
      const endDate = computeEndDate(selectedDate, daysCount)
      const response = await fetch('/api/meal-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'generate',
          startDate: selectedDate,
          endDate,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        if (response.status === 429) {
          setError(tErrors('rateLimit'))
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
      <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-6 pt-8 pb-8">
            <div className="bg-primary/10 flex h-16 w-16 items-center justify-center rounded-full">
              <ChefHat className="text-primary h-8 w-8" />
            </div>
            <div className="flex flex-col gap-2 text-center">
              <Heading variant="h2">
                {userName ? tFirst('welcome', { userName }) : tFirst('welcomeNoName')}
              </Heading>
              <Body variant="muted">{tFirst('subhead')}</Body>
            </div>

            <div className="flex w-full flex-col gap-4">
              <section className="flex flex-col gap-2">
                <Label className="text-sm font-semibold">{tFirst('startFromLabel')}</Label>
                <div className="flex flex-wrap gap-2">
                  {startDateOptions.map((option) => (
                    <Button
                      key={option.date}
                      variant={selectedDate === option.date ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedDate(option.date)}
                      disabled={isGenerating}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </section>

              <section className="flex flex-col gap-2">
                <Label className="text-sm font-semibold">{tFirst('daysCountLabel')}</Label>
                <div className="flex flex-wrap gap-2">
                  {daysCountOptions.map((option) => (
                    <Button
                      key={option.value}
                      variant={daysCount === option.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDaysCount(option.value)}
                      disabled={isGenerating}
                    >
                      {tFirst('dayOption', { count: option.value })}
                    </Button>
                  ))}
                </div>
              </section>
            </div>

            {error && (
              <Body variant="small" className="text-destructive">
                {error}
              </Body>
            )}

            <Button onClick={handleGenerate} disabled={isGenerating} size="lg" className="w-full">
              {isGenerating ? tFirst('submitting') : tFirst('submit')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

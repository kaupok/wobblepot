'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CardContent, CardFooter } from '@/components/ui/card'
import { GeneratingOverlay } from '@/components/meal-plan/GeneratingOverlay'
import { FirstPlanChoices } from '@/components/timeline/FirstPlanChoices'
import { FieldError } from '@/components/FieldError'
import { useGenerateFirstPlan } from '@/hooks/use-generate-first-plan'

/**
 * The last onboarding step: the household exists, and its first plan is one
 * tap away. It ends on Today with the plan. Leaving before that is safe: Today
 * shows a household with no plan the same choices (`FirstTimeSetup`).
 */
export function FirstPlanStep() {
  const router = useRouter()
  const t = useTranslations('onboarding')
  const plan = useGenerateFirstPlan({
    onGenerated: () => {
      router.push('/')
      router.refresh()
    },
  })

  // The button is disabled while the plan generates, which drops focus to the
  // body (CLAUDE.md → Focus management). An error appears only once the
  // request has failed and the button is enabled again, so it takes focus
  // back then. A retry clears the error, so each failure refocuses once.
  const submitRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (plan.error && !plan.isGenerating) submitRef.current?.focus()
  }, [plan.error, plan.isGenerating])

  return (
    <>
      {plan.isGenerating && <GeneratingOverlay />}
      <CardContent>
        <FirstPlanChoices
          startDateOptions={plan.startDateOptions}
          daysCountOptions={plan.daysCountOptions}
          selectedDate={plan.selectedDate}
          onSelectedDateChange={plan.setSelectedDate}
          daysCount={plan.daysCount}
          onDaysCountChange={plan.setDaysCount}
          disabled={plan.isGenerating}
          headingAs="h2"
          showDefaultsNote
        />
        {plan.error && (
          <div className="mt-4">
            <FieldError>{plan.error}</FieldError>
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-6">
        <Button
          ref={submitRef}
          type="button"
          size="lg"
          className="w-full"
          onClick={plan.generate}
          disabled={plan.isGenerating}
        >
          {plan.isGenerating ? t('planSubmitting') : t('planSubmit')}
        </Button>
      </CardFooter>
    </>
  )
}

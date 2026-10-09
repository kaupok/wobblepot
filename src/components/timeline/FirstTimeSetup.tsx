'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'
import { GeneratingOverlay } from '@/components/meal-plan/GeneratingOverlay'
import { FieldError } from '@/components/FieldError'
import { useGenerateFirstPlan } from '@/hooks/use-generate-first-plan'
import { FirstPlanChoices } from './FirstPlanChoices'

interface FirstTimeSetupProps {
  userName?: string
}

/**
 * Today for a household with no plan yet. Onboarding ends on the same choices
 * (`FirstPlanStep`), so this is what a household sees when it left that step
 * before generating, or when a member joins before the first plan.
 */
export function FirstTimeSetup({ userName }: FirstTimeSetupProps) {
  const router = useRouter()
  const tFirst = useTranslations('meal-plan.firstTime')
  const tToday = useTranslations('today')
  const plan = useGenerateFirstPlan({ onGenerated: () => router.refresh() })
  const generateRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      {/* Today's page title, as in `TimelineView` (HON-815). */}
      <div className="sr-only">
        <Heading variant="h4" as="h1">
          {tToday('pageTitle')}
        </Heading>
      </div>
      {plan.isGenerating && <GeneratingOverlay returnFocusRef={generateRef} />}
      <div className="min-h-screen-below-header-gutters flex w-full items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-6 pt-8 pb-8">
            <div className="flex flex-col gap-2 text-center">
              <Heading variant="h4" as="h2">
                {userName ? tFirst('welcome', { userName }) : tFirst('welcomeNoName')}
              </Heading>
              <Body variant="muted">{tFirst('subhead')}</Body>
            </div>

            <FirstPlanChoices
              startDateOptions={plan.startDateOptions}
              daysCountOptions={plan.daysCountOptions}
              selectedDate={plan.selectedDate}
              onSelectedDateChange={plan.setSelectedDate}
              daysCount={plan.daysCount}
              onDaysCountChange={plan.setDaysCount}
              disabled={plan.isGenerating}
            />

            {plan.error && <FieldError>{plan.error}</FieldError>}

            <Button
              ref={generateRef}
              onClick={plan.generate}
              disabled={plan.isGenerating}
              size="lg"
              className="w-full md:w-auto md:self-start"
            >
              {plan.isGenerating ? tFirst('submitting') : tFirst('submit')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CardContent, CardFooter } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Body } from '@/components/ui/typography'
import { GeneratingOverlay } from '@/components/meal-plan/GeneratingOverlay'
import { FirstPlanChoices } from '@/components/timeline/FirstPlanChoices'
import { FieldError } from '@/components/FieldError'
import { useGenerateFirstPlan } from '@/hooks/use-generate-first-plan'
import { ApiError, apiFetch } from '@/lib/api'
import { DEFAULT_REMINDER_WEEKDAY } from '@/lib/weekly-reminder-schedule'

/**
 * The last onboarding step: the household exists, and its first plan is one
 * tap away. It ends on Today with the plan. Leaving before that is safe: Today
 * shows a household with no plan the same choices (`FirstTimeSetup`).
 *
 * It also offers the weekly planning reminder (HON-1084), the only place
 * outside `/household` that asks for that consent, so the checkbox is never
 * ticked for the person.
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
  const [remind, setRemind] = useState(false)

  // Switches the reminder on for Sunday, or back off. A failure is logged and
  // the plan goes ahead: the person can set it later on the Household page.
  const reminder = useMutation({
    mutationFn: (weekday: typeof DEFAULT_REMINDER_WEEKDAY | null) =>
      apiFetch('/api/households/me/members/me/reminder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekday }),
      }),
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.error(
        '[onboarding] reminder opt-in failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
    },
  })

  const busy = plan.isGenerating || reminder.isPending

  // Saved before the plan generates. On a retry after a failed plan, it is
  // saved again only if the box changed since, so unticking it then switches
  // the reminder back off.
  const handlePlan = () => {
    const wanted = remind ? DEFAULT_REMINDER_WEEKDAY : null
    const saved = reminder.isSuccess ? reminder.variables : null
    if (wanted === saved) {
      plan.generate()
    } else {
      reminder.mutate(wanted, { onSettled: () => plan.generate() })
    }
  }

  // The button is disabled while the plan generates, which drops focus to the
  // body (CLAUDE.md → Focus management). An error appears only once the
  // request has failed and the button is enabled again, so it takes focus
  // back then. A retry clears the error, so each failure refocuses once.
  const submitRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (plan.error && !busy) submitRef.current?.focus()
  }, [plan.error, busy])

  return (
    <>
      {plan.isGenerating && <GeneratingOverlay returnFocusRef={submitRef} />}
      <CardContent>
        <FirstPlanChoices
          startDateOptions={plan.startDateOptions}
          daysCountOptions={plan.daysCountOptions}
          selectedDate={plan.selectedDate}
          onSelectedDateChange={plan.setSelectedDate}
          daysCount={plan.daysCount}
          onDaysCountChange={plan.setDaysCount}
          disabled={busy}
          headingAs="h2"
          showDefaultsNote
        />
        <div className="mt-6 flex items-start gap-2">
          <Checkbox
            id="reminder-opt-in"
            checked={remind}
            onCheckedChange={(checked) => setRemind(checked === true)}
            disabled={busy}
            aria-describedby="reminder-opt-in-note"
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor="reminder-opt-in" className="font-normal">
              <span className="leading-snug">{t('reminderOptIn')}</span>
            </Label>
            {/* The address is confirmed by link before the first send (HON-1113),
                and the plan step goes straight to Today, so say it here. */}
            <Body id="reminder-opt-in-note" variant="muted">
              {t('reminderOptInConfirmNote')}
            </Body>
          </div>
        </div>
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
          onClick={handlePlan}
          disabled={busy}
        >
          {busy ? t('planSubmitting') : t('planSubmit')}
        </Button>
      </CardFooter>
    </>
  )
}

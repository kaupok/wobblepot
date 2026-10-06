'use client'

import { useId } from 'react'
import { useTranslations } from 'next-intl'
import { ChoiceChips } from '@/components/ui/choice-chips'
import { Heading, Body } from '@/components/ui/typography'
import type { DayOption, DaysCountOption } from '@/lib/meal-planning/day-picker'

interface FirstPlanChoicesProps {
  startDateOptions: DayOption[]
  daysCountOptions: DaysCountOption[]
  selectedDate: string
  onSelectedDateChange: (date: string) => void
  daysCount: number
  onDaysCountChange: (count: number) => void
  disabled?: boolean
  /** One level under the screen's title: `h3` under Today's `h2`, `h2` under onboarding's `h1`. */
  headingAs?: 'h2' | 'h3'
  /**
   * The line that the first plan is dinners only. Only where that is known to
   * hold: onboarding's step 3, just after household creation wrote the
   * dinner-only defaults. Today's `FirstTimeSetup` can be reached after the
   * household set meals, a diet or allergies, and the plan uses them.
   */
  showDefaultsNote?: boolean
}

/**
 * The first plan's two choices, start day and length, and optionally the line
 * that says what the plan holds before any preference is set: dinners, with no
 * diet or allergy filter (docs/PROJECT_SPEC.md → Onboarding). The line is there
 * so a family is not surprised by the first plan, and knows where to change it.
 * Used by the last onboarding step and by Today's `FirstTimeSetup`; state and
 * the request live in `useGenerateFirstPlan`.
 */
export function FirstPlanChoices({
  startDateOptions,
  daysCountOptions,
  selectedDate,
  onSelectedDateChange,
  daysCount,
  onDaysCountChange,
  disabled,
  headingAs = 'h3',
  showDefaultsNote = false,
}: FirstPlanChoicesProps) {
  const t = useTranslations('meal-plan.firstTime')
  const startFromId = useId()
  const daysCountId = useId()

  return (
    <div className="flex w-full flex-col gap-4">
      <section className="flex flex-col gap-2" aria-labelledby={startFromId}>
        <Heading variant="section" as={headingAs} id={startFromId}>
          {t('startFromLabel')}
        </Heading>
        <ChoiceChips
          aria-labelledby={startFromId}
          size="sm"
          value={selectedDate}
          onValueChange={onSelectedDateChange}
          options={startDateOptions.map((option) => ({
            value: option.date,
            label: option.label,
          }))}
          disabled={disabled}
        />
      </section>

      <section className="flex flex-col gap-2" aria-labelledby={daysCountId}>
        <Heading variant="section" as={headingAs} id={daysCountId}>
          {t('daysCountLabel')}
        </Heading>
        <ChoiceChips
          aria-labelledby={daysCountId}
          size="sm"
          value={String(daysCount)}
          onValueChange={(v) => onDaysCountChange(Number(v))}
          options={daysCountOptions.map((option) => ({
            value: String(option.value),
            label: t('dayOption', { count: option.value }),
          }))}
          disabled={disabled}
        />
      </section>

      {showDefaultsNote && <Body variant="muted">{t('defaultsNote')}</Body>}
    </div>
  )
}

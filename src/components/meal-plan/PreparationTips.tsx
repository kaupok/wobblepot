'use client'

import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { Body, Heading, Li, Ol, Ul } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { StructuredTips } from '@/components/meal-plan/types'

// The cook view's preparation guide (docs/DESIGN.md → "Cook view", HON-932),
// split in two: the equipment reads as part of the shopping-and-setup column
// ("You'll need", beside the ingredients), and everything you do at the stove
// renders in the steps area at the step size. Both sit straight on the meal's
// tint — no panel of their own.

interface PreparationEquipmentProps {
  equipment?: string[] | null
}

/** "You'll need: a sheet pan, tongs", under the ingredients once tips exist. */
export function PreparationEquipment({ equipment }: PreparationEquipmentProps) {
  const t = useTranslations('meal-plan.tips')
  if (!equipment?.length) return null
  return <Body variant="paragraph">{t('equipment', { list: equipment.join(', ') })}</Body>
}

interface PreparationStepsProps {
  tips: StructuredTips | null
  isLoading: boolean
  error: string | null
  onRetry: () => void
  /** The household's own notes on the meal: shown first, and always */
  preparationNotes?: string | null
  /** Indices of the steps the cook has marked done (HON-933) */
  doneSteps?: ReadonlySet<number>
  /**
   * Makes each generated step a toggle: tap to mark it done, tap again to
   * un-mark it. Without it the steps are a plain numbered list.
   */
  onToggleStep?: (index: number) => void
}

/** A sub-section of the steps area: Watch out, Tip. Same level as Steps. */
function StepsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <Heading variant="h4" as="h3">
        {title}
      </Heading>
      {children}
    </section>
  )
}

function UserNotes({ notes }: { notes: string }) {
  const t = useTranslations('meal-plan.tips')
  return (
    <div className="flex flex-col gap-2">
      <Heading variant="section" as="h4">
        {t('userNotes')}
      </Heading>
      <Body variant="step" className="whitespace-pre-line">
        {notes}
      </Body>
    </div>
  )
}

/**
 * The numeral that starts each step: a filled circle on the chip token, big
 * enough to find your place from across the counter. Decorative — the list
 * already tells assistive tech the position, and a toggle's `aria-pressed`
 * says whether it is done.
 *
 * A done step shows a check instead of its number. The current step's row is
 * itself on the chip token, so its circle takes the page background instead,
 * the pairing a surface badge uses on the tint (globals.css).
 */
function StepNumber({
  n,
  done = false,
  current = false,
}: {
  n: number
  done?: boolean
  current?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full text-lg font-semibold tabular-nums transition-colors duration-150 ease-out motion-reduce:transition-none lg:size-10 lg:text-xl',
        current ? 'bg-background text-foreground' : 'bg-secondary text-secondary-foreground',
      )}
    >
      {done ? <Check className="size-5 lg:size-6" /> : n}
    </span>
  )
}

interface StepToggleProps {
  step: string
  index: number
  done: boolean
  current: boolean
  onToggle: (index: number) => void
}

/**
 * One step as a toggle (HON-933). The whole row is the target, at least 44px
 * tall, for a knuckle from across the counter. Done reads as the check and
 * the muted tone, never a strike-through: a struck line is hard to read when
 * you look back at it. The current step — the first one not done — sits on
 * the chip token so a glance finds your place.
 *
 * The focus outline is the tint's text colour: the theme's grey ring all but
 * disappears on a meal tint.
 */
function StepToggle({ step, index, done, current, onToggle }: StepToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={done}
      data-current={current ? '' : undefined}
      onClick={() => onToggle(index)}
      className={cn(
        'focus-visible:outline-foreground flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none',
        current && 'bg-secondary',
      )}
    >
      <StepNumber n={index + 1} done={done} current={current} />
      <Body variant="step" tone={done ? 'muted' : 'default'}>
        {step}
      </Body>
    </button>
  )
}

/** One step's placeholder: the numeral, a full line and a short one. */
function StepSkeleton() {
  return (
    <div className="flex items-start gap-3">
      <Skeleton shape="circle" className="size-9 shrink-0 lg:size-10" />
      <div className="flex flex-1 flex-col gap-1">
        <Skeleton className="h-7 w-full lg:h-8" />
        <Skeleton className="h-7 w-1/2 lg:h-8" />
      </div>
    </div>
  )
}

/**
 * Skeleton lines at the step text's line height (`text-lg leading-relaxed`,
 * 32.5px; 35.75px from `lg`) beside a numeral-sized circle, so the steps land
 * where their placeholders were.
 */
function StepsSkeleton() {
  const t = useTranslations('meal-plan.tips')
  return (
    <div className="flex flex-col gap-6" data-testid="preparation-steps-loading">
      {/* A generation can take up to 45s (`TIPS_AI_BUDGET_MS`): say that
          something is happening, not only show shapes (HON-933). */}
      <div role="status">
        <Body variant="step" tone="muted">
          {t('generating')}
        </Body>
      </div>
      <div className="flex flex-col gap-4">
        <StepSkeleton />
        <StepSkeleton />
        <StepSkeleton />
      </div>
      <StepsSection title={t('pitfalls')}>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-7 w-11/12 lg:h-8" />
          <Skeleton className="h-7 w-10/12 lg:h-8" />
        </div>
      </StepsSection>
    </div>
  )
}

/**
 * The steps area below its "Steps" heading: the household's notes, then the
 * generated steps, Watch out and Tip — or their skeleton while generating, or
 * the error with Retry. Renders nothing when there is nothing to show; the
 * caller keeps the "How to prepare" call to action beside it until tips load.
 */
export function PreparationSteps({
  tips,
  isLoading,
  error,
  onRetry,
  preparationNotes,
  doneSteps,
  onToggleStep,
}: PreparationStepsProps) {
  const t = useTranslations('meal-plan.tips')
  const notes = preparationNotes?.trim() ? preparationNotes : null
  // The first step not done yet; none once every step is (-1 matches no index).
  const currentStep = tips?.steps?.findIndex((_, i) => !doneSteps?.has(i)) ?? -1

  let generated: React.ReactNode = null
  if (isLoading) {
    generated = <StepsSkeleton />
  } else if (error) {
    generated = (
      <div className="flex flex-col items-start gap-3">
        <Body variant="paragraph">{error}</Body>
        <Button variant="outline" size="lg" onClick={onRetry}>
          {t('retry')}
        </Button>
      </div>
    )
  } else if (tips) {
    generated = (
      <>
        {!!tips.steps?.length &&
          (onToggleStep ? (
            // The row's padding sits outside the text's column, so the
            // numerals line up with the heading above as the static list does.
            <div className="-mx-3">
              <Ol variant="steps">
                {tips.steps.map((step, i) => (
                  <Li key={i}>
                    <StepToggle
                      step={step}
                      index={i}
                      done={doneSteps?.has(i) ?? false}
                      current={i === currentStep}
                      onToggle={onToggleStep}
                    />
                  </Li>
                ))}
              </Ol>
            </div>
          ) : (
            <Ol variant="steps">
              {tips.steps.map((step, i) => (
                <Li key={i} className="flex items-start gap-3">
                  <StepNumber n={i + 1} />
                  <Body variant="step">{step}</Body>
                </Li>
              ))}
            </Ol>
          ))}
        {tips.pitfalls.length > 0 && (
          <StepsSection title={t('pitfalls')}>
            <Ul variant="plain">
              {tips.pitfalls.map((pitfall, i) => (
                <Li key={i}>
                  <Body variant="step">{pitfall}</Body>
                </Li>
              ))}
            </Ul>
          </StepsSection>
        )}
        {tips.tip && (
          <StepsSection title={t('tip')}>
            <Body variant="step">{tips.tip}</Body>
          </StepsSection>
        )}
      </>
    )
  }

  if (!notes && !generated) return null

  return (
    <div className="flex flex-col gap-6">
      {notes && <UserNotes notes={notes} />}
      {generated}
    </div>
  )
}

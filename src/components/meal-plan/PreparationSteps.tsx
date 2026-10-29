'use client'

import { Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useRef } from 'react'

import type { PreparationSteps as PreparationStepsData } from '@/components/meal-plan/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Body, Heading, Li, Ol, Ul } from '@/components/ui/typography'
import { COOK_QUESTION_EQUIPMENT_MAX_ITEMS } from '@/lib/ai/cook-question-limits'
import { type CookQuestionSubject, sameSubject } from '@/lib/ai/cook-question-subject'
import { cn } from '@/lib/utils'

import { CookQuestionMenu, type CookQuestionMenuProps } from './CookQuestionMenu'
import { type CookQuestionControls, CookQuestionPanel } from './CookQuestionPanel'

export type { CookQuestionControls }
import { PreparationNotes } from './PreparationNotes'

// The cook view's preparation guide (docs/DESIGN.md → "Cook view", HON-932),
// split in two: the equipment reads as part of the shopping-and-setup column
// ("You'll need", beside the ingredients), and everything you do at the stove
// renders in the steps area at the step size. Both sit straight on the meal's
// tint — no panel of their own.

interface PreparationEquipmentProps {
  equipment?: string[] | null
  /** The steps on screen; an equipment question sends them (HON-983) */
  steps?: string[] | null
  /**
   * Puts a ⋯ menu at the end of each row (HON-983, HON-1350), as on the steps. The
   * caller passes it only for a planned entry it can edit.
   */
  cookQuestion?: CookQuestionControls
}

/**
 * "You'll need", then one item per row, once tips exist (HON-952). It tops
 * the steps column, above "Steps": it is what a cook sets out before step 1
 * (HON-966). A cook scans it like the ingredients — is it on the counter or
 * not — so the rows take the ingredient rows' 18px. The heading is the same
 * level as Steps, Watch out and Tip.
 *
 * With `cookQuestion` each row ends in a ⋯ menu, a sibling of the item text,
 * that opens the question panel under the row (HON-983, HON-1350): "I don't
 * have a wok" is asked here, not on the step that uses it.
 */
export function PreparationEquipment({
  equipment,
  steps,
  cookQuestion,
}: PreparationEquipmentProps) {
  const t = useTranslations('meal-plan.steps')
  const tAsk = useTranslations('meal-plan.cookQuestion')
  const headingId = useId()
  const panels = useAskPanels(cookQuestion, 'equipment', steps ?? [], equipment ?? [])
  if (!equipment?.length) return null
  // The route answers about the steps too, and needs at least one.
  const askable = cookQuestion && steps?.length ? cookQuestion : null
  return (
    <div className="flex flex-col gap-3 text-base">
      <Heading variant="h4" as="h3" id={headingId}>
        {t('equipment')}
      </Heading>
      <Ul variant="plain" aria-labelledby={headingId}>
        {equipment.map((item, i) =>
          // Only rows the route keeps: it drops empty items and those past
          // its cap, so a question there could only fail.
          askable && steps && item.trim() && i < COOK_QUESTION_EQUIPMENT_MAX_ITEMS ? (
            <Li key={`${i}-${item}`}>
              {/* Top-aligned, as a step row is: a long item wraps beside the
                  button, and the padding centres one line on its 44px. */}
              <div className="flex items-start gap-1">
                <span className="min-w-0 flex-1 py-2">{item}</span>
                <CookQuestionMenu label={tAsk('askAboutItem', { item })} {...panels.menuProps(i)} />
              </div>
              {panels.isOpen(i) && (
                <CookQuestionPanel
                  {...panels.panelProps(i)}
                  steps={steps}
                  equipment={equipment}
                  controls={askable}
                />
              )}
            </Li>
          ) : (
            <Li key={`${i}-${item}`}>{item}</Li>
          ),
        )}
      </Ul>
    </div>
  )
}

interface PreparationStepsProps {
  steps: PreparationStepsData | null
  isLoading: boolean
  error: string | null
  onRetry: () => void
  /**
   * The household's own notes on the meal: last, closed under "Your notes",
   * and also while the steps load or fail (HON-1259)
   */
  preparationNotes?: string | null
  /** Indices of the steps the cook has marked done (HON-933) */
  doneSteps?: ReadonlySet<number>
  /**
   * Makes each generated step a toggle: tap to mark it done, tap again to
   * un-mark it. Without it the steps are a plain numbered list.
   */
  onToggleStep?: (index: number) => void
  /**
   * Puts a ⋯ menu beside each step toggle (HON-969, HON-1350). The caller passes
   * it for a planned entry it can edit, and for a recipe opened from My
   * recipes (HON-1339).
   */
  cookQuestion?: CookQuestionControls
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
 * you look back at it. The current step — the first one not done — is
 * marked by its row, which `ToggleSteps` puts on the chip token.
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
      className="focus-visible:outline-foreground flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <StepNumber n={index + 1} done={done} current={current} />
      <Body variant="step" tone={done ? 'muted' : 'default'}>
        {step}
      </Body>
    </button>
  )
}

/**
 * The ⋯ menus and panels of one section, the steps or "You'll need"
 * (HON-983), so both behave the same: panel ids, a pick that opens the row's
 * panel and focuses Close or the field (HON-1350), focus back to the row's ⋯
 * button on Close, and a tooltip kept shut on the focus a tap hands back.
 */
function useAskPanels(
  cookQuestion: CookQuestionControls | undefined,
  kind: CookQuestionSubject['kind'],
  steps: string[],
  equipment: string[],
) {
  const panelIdPrefix = useId()
  const menuButtons = useRef(new Map<number, HTMLButtonElement>())
  // The open panel's; one panel is open at a time.
  const inputRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Set around the focus a tap or a click on Close returns, so the ⋯
  // button's tooltip stays shut; a key on Close or Escape opens it as Tab does.
  const quietFocus = useRef(false)

  const closePanel = (index: number, byPointer = false) => {
    cookQuestion?.onClose()
    quietFocus.current = byPointer
    menuButtons.current.get(index)?.focus()
    quietFocus.current = false
  }

  const subjectAt = (index: number): CookQuestionSubject => ({ kind, index })
  const isOpen = (index: number) => sameSubject(cookQuestion?.openSubject, subjectAt(index))
  const panelId = (index: number) => `${panelIdPrefix}-panel-${index}`
  // Row `index`'s answer is on its way (HON-1360).
  const isBusy = (index: number) =>
    !!cookQuestion &&
    (cookQuestion.isPending || cookQuestion.isStreaming) &&
    sameSubject(cookQuestion.active?.subject, subjectAt(index))

  return {
    isOpen,
    /** Row `index`'s ⋯ menu, all but its label */
    menuProps: (index: number): Omit<CookQuestionMenuProps, 'label'> => ({
      ref: (el: HTMLButtonElement | null) => {
        if (el) menuButtons.current.set(index, el)
        else menuButtons.current.delete(index)
      },
      kind,
      open: isOpen(index),
      busy: isBusy(index),
      panelId: panelId(index),
      quietFocus,
      // Opening resets the question on screen, so a pick on an open row
      // replaces it, as a question from another row would.
      onAsk: (question) => {
        if (!cookQuestion || isBusy(index)) return
        const subject = subjectAt(index)
        cookQuestion.onOpenSubject(subject)
        // 'chip' still names a ready-made question in analytics.
        cookQuestion.ask({ subject, steps, equipment, question, source: 'chip' })
      },
      onAskOwn: () => cookQuestion?.onOpenSubject(subjectAt(index)),
      // No scroll: the panel's own scroll into view is under way, and a
      // focus scroll would cut it short with Close below the fold.
      onFocusPanel: (target) =>
        (target === 'close' ? closeRef : inputRef).current?.focus({ preventScroll: true }),
    }),
    /** Row `index`'s panel, all but what it asks with */
    panelProps: (index: number) => ({
      id: panelId(index),
      subject: subjectAt(index),
      inputRef,
      closeRef,
      onClose: (byPointer?: boolean) => closePanel(index, byPointer),
    }),
  }
}

interface ToggleStepsProps {
  steps: string[]
  /** "You'll need", which a step question sends too (HON-983) */
  equipment: string[]
  doneSteps?: ReadonlySet<number>
  currentStep: number
  onToggleStep: (index: number) => void
  cookQuestion?: CookQuestionControls
}

/**
 * The generated steps as toggles (HON-933), each with a ⋯ menu beside it when
 * the caller passes `cookQuestion` (HON-969, HON-1350). The ⋯ button is the
 * toggle's sibling, never inside it: a button inside a button is invalid.
 */
function ToggleSteps({
  steps,
  equipment,
  doneSteps,
  currentStep,
  onToggleStep,
  cookQuestion,
}: ToggleStepsProps) {
  const t = useTranslations('meal-plan.cookQuestion')
  const panels = useAskPanels(cookQuestion, 'step', steps, equipment)

  return (
    // The row's left padding sits outside the text's column, so the numerals
    // line up with the heading above as the static list does. On the right
    // only the background bleeds (`-mr-3 pr-3`), so the ⋯ buttons end where
    // the ones in "You'll need" do (HON-1022) and sit inside the current
    // step's chip (HON-1369).
    <div className="-ml-3">
      <Ol variant="steps">
        {steps.map((step, i) => (
          <Li key={i}>
            <div
              className={cn(
                '-mr-3 flex items-start gap-1 rounded-lg pr-3 transition-colors duration-150 ease-out motion-reduce:transition-none',
                i === currentStep && 'bg-secondary',
              )}
            >
              <StepToggle
                step={step}
                index={i}
                done={doneSteps?.has(i) ?? false}
                current={i === currentStep}
                onToggle={onToggleStep}
              />
              {cookQuestion && (
                <CookQuestionMenu
                  label={t('askAboutStep', { n: i + 1 })}
                  {...panels.menuProps(i)}
                />
              )}
            </div>
            {cookQuestion && panels.isOpen(i) && (
              <CookQuestionPanel
                {...panels.panelProps(i)}
                steps={steps}
                equipment={equipment}
                controls={cookQuestion}
              />
            )}
          </Li>
        ))}
      </Ol>
    </div>
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
  const t = useTranslations('meal-plan.steps')
  return (
    <div className="flex flex-col gap-6" data-testid="preparation-steps-loading">
      {/* A generation can take up to 45s (`STEPS_AI_BUDGET_MS`): say that
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
 * The steps area below its "Steps" heading: the generated steps, Watch out and
 * Tip — or their skeleton while generating, or the error with Retry — then the
 * household's notes, closed. Every meal's steps are generated, the notes an
 * input to them (HON-1259), so the notes come last and in every state: the
 * household can still cook from their own text while the steps load or fail.
 * Renders nothing when there is nothing to show; the caller keeps the "How to
 * prepare" call to action beside it until tips load.
 */
export function PreparationSteps({
  steps,
  isLoading,
  error,
  onRetry,
  preparationNotes,
  doneSteps,
  onToggleStep,
  cookQuestion,
}: PreparationStepsProps) {
  const t = useTranslations('meal-plan.steps')
  const notes = preparationNotes?.trim() ? preparationNotes : null
  // The first step not done yet; none once every step is (-1 matches no index).
  const currentStep = steps?.steps?.findIndex((_, i) => !doneSteps?.has(i)) ?? -1

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
  } else if (steps) {
    generated = (
      <>
        {!!steps.steps?.length &&
          (onToggleStep ? (
            <ToggleSteps
              steps={steps.steps}
              equipment={steps.equipment ?? []}
              doneSteps={doneSteps}
              currentStep={currentStep}
              onToggleStep={onToggleStep}
              cookQuestion={cookQuestion}
            />
          ) : (
            <Ol variant="steps">
              {steps.steps.map((step, i) => (
                <Li key={i} className="flex items-start gap-3">
                  <StepNumber n={i + 1} />
                  <Body variant="step">{step}</Body>
                </Li>
              ))}
            </Ol>
          ))}
        {steps.pitfalls.length > 0 && (
          <StepsSection title={t('pitfalls')}>
            <Ul variant="plain">
              {steps.pitfalls.map((pitfall, i) => (
                <Li key={i}>
                  <Body variant="step">{pitfall}</Body>
                </Li>
              ))}
            </Ul>
          </StepsSection>
        )}
        {steps.tip && (
          <StepsSection title={t('tip')}>
            <Body variant="step">{steps.tip}</Body>
          </StepsSection>
        )}
      </>
    )
  }

  if (!notes && !generated) return null

  return (
    <div className="flex flex-col gap-6">
      {generated}
      {notes && <PreparationNotes notes={notes} />}
    </div>
  )
}

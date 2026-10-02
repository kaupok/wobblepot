'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, MessageCircleQuestion } from 'lucide-react'
import { Body, Heading, Li, Ol, Ul } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, prefersReducedMotion } from '@/lib/utils'
import type { StructuredTips } from '@/components/meal-plan/types'
import type {
  CookQuestionActive,
  CookQuestionAskInput,
  CookQuestionError,
} from '@/hooks/use-cook-question'

// The cook view's preparation guide (docs/DESIGN.md → "Cook view", HON-932),
// split in two: the equipment reads as part of the shopping-and-setup column
// ("You'll need", beside the ingredients), and everything you do at the stove
// renders in the steps area at the step size. Both sit straight on the meal's
// tint — no panel of their own.

interface PreparationEquipmentProps {
  equipment?: string[] | null
}

/**
 * "You'll need", then one item per row, once tips exist (HON-952). It tops
 * the steps column, above "Steps": it is what a cook sets out before step 1
 * (HON-966). A cook scans it like the ingredients — is it on the counter or
 * not — so the rows take the ingredient rows' 18px. The heading is the same
 * level as Steps, Watch out and Tip.
 */
export function PreparationEquipment({ equipment }: PreparationEquipmentProps) {
  const t = useTranslations('meal-plan.tips')
  const headingId = useId()
  if (!equipment?.length) return null
  return (
    <div className="flex flex-col gap-3 text-base">
      <Heading variant="h4" as="h3" id={headingId}>
        {t('equipment')}
      </Heading>
      <Ul variant="plain" aria-labelledby={headingId}>
        {equipment.map((item, i) => (
          <Li key={`${i}-${item}`}>{item}</Li>
        ))}
      </Ul>
    </div>
  )
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
  /**
   * Puts an Ask button beside each step toggle (HON-969). The caller passes
   * it only for a planned entry it can edit.
   */
  cookQuestion?: CookQuestionControls
}

/**
 * The cook-question state, owned by `MealDetailModal` through
 * `useCookQuestion`, so this component stays presentational.
 */
export interface CookQuestionControls {
  /** The step whose panel is open; one at a time */
  openStep: number | null
  onOpenStep: (index: number) => void
  onClose: () => void
  ask: (input: CookQuestionAskInput) => void
  active: CookQuestionActive | null
  isPending: boolean
  error: CookQuestionError | null
  onRetry: () => void
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
        'focus-visible:outline-foreground flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none',
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

const CHIP_KEYS = ['done', 'substitute', 'time'] as const

/**
 * Scroll `el` into its nearest scrollable ancestor: the dialog's one column
 * below `lg`, the steps column from `lg`. "Nearest" leaves an element that is
 * already in view where it is. Focus does not move.
 */
function scrollIntoViewNearest(el: HTMLElement | null) {
  el?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

interface CookQuestionPanelProps {
  id: string
  stepIndex: number
  steps: string[]
  controls: CookQuestionControls
  /** Move focus into the field on mount: the cook switched from another step's panel. */
  focusField: boolean
  /** Close the panel and return focus to its Ask button */
  onClose: () => void
}

/**
 * The question panel under one step (HON-969): three chips that send at once,
 * a field with Send, then the question asked with Edit (HON-976) above
 * "Thinking…", the answer, or the error with Retry. It sits straight on the
 * tint, indented to the step text, with no card or border of its own
 * (docs/DESIGN.md → cook view). It scrolls into view when it opens, and the
 * answer with Close does when it arrives (HON-977), so a step low in the view
 * never answers below the fold.
 */
function CookQuestionPanel({
  id,
  stepIndex,
  steps,
  controls,
  focusField,
  onClose,
}: CookQuestionPanelProps) {
  const t = useTranslations('meal-plan.cookQuestion')
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  // Counts Edit presses: the field gets focus once the question is in it, with
  // the caret after the text, ready to change the end of it. A count, not a
  // flag on `text`, so a second Edit with the text unchanged still focuses.
  const [editCount, setEditCount] = useState(0)
  const questionId = useId()
  const { ask, active, isPending, error, onRetry } = controls
  const ownStep = active?.stepIndex === stepIndex
  const asked = ownStep ? active.question : null
  const answer = ownStep ? active.answer : null

  useEffect(() => {
    if (focusField) inputRef.current?.focus()
  }, [focusField])

  // Opened under a step low in the view, the chips and field show at once.
  useEffect(() => {
    scrollIntoViewNearest(panelRef.current)
  }, [])

  // The answer or the error, with Close under it, once the wait is over. Not
  // "Thinking…": the field the cook may be typing in stays where it is.
  useEffect(() => {
    if (!isPending && (answer || error)) scrollIntoViewNearest(resultRef.current)
  }, [isPending, answer, error])

  useEffect(() => {
    const input = inputRef.current
    if (editCount === 0 || !input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [editCount])

  const send = (question: string, source: CookQuestionAskInput['source']) =>
    ask({ stepIndex, steps, question, source })

  return (
    <div
      ref={panelRef}
      id={id}
      role="group"
      aria-label={t('askAboutStep', { n: stepIndex + 1 })}
      className="flex flex-col gap-3 pt-1 pr-3 pb-2 pl-15 lg:pl-16"
    >
      <div className="flex flex-wrap gap-2">
        {CHIP_KEYS.map((key) => (
          <Button
            key={key}
            variant="outline"
            size="lg"
            // Like Send: a second tap while the answer is on its way would
            // bill a second AI call, because the route runs on after the
            // browser aborts the first.
            aria-disabled={isPending}
            onClick={() => {
              if (isPending) return
              send(t(`chips.${key}`), 'chip')
            }}
          >
            {t(`chips.${key}`)}
          </Button>
        ))}
      </div>
      {/* A form, so Enter in the field sends (CLAUDE.md → Form Handling). */}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          // `aria-disabled`, not `disabled`, keeps focus on Send while the
          // answer is on its way (CLAUDE.md → Focus management).
          if (isPending) return
          const question = text.trim()
          if (!question) return
          send(question, 'text')
          setText('')
        }}
      >
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // The dialog leaves Escape in a text field to the field.
            if (e.key === 'Escape') onClose()
          }}
          aria-label={t('questionLabel')}
          placeholder={t('placeholder')}
          maxLength={300}
          enterKeyHint="send"
        />
        <Button type="submit" aria-disabled={isPending}>
          {t('send')}
        </Button>
      </form>
      {/* What was asked, so a chip's answer has its question and a typed one
          can be changed and sent again (HON-976). Outside the status region:
          the cook just asked it, so announcing it again adds nothing. */}
      {asked && (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 pt-2">
            <Body variant="step" tone="muted" id={questionId}>
              {t('youAsked', { question: asked })}
            </Body>
          </div>
          <Button
            variant="ghost"
            size="lg"
            className="shrink-0"
            aria-describedby={questionId}
            onClick={() => {
              setText(asked)
              setEditCount((n) => n + 1)
            }}
          >
            {t('edit')}
          </Button>
        </div>
      )}
      {/* One box for the answer and the row under it, so one scroll brings
          both into view (HON-977). */}
      <div ref={resultRef} data-slot="cook-question-result" className="flex flex-col gap-3">
        <div role="status">
          {isPending ? (
            <Body variant="step" tone="muted">
              {t('thinking')}
            </Body>
          ) : error ? (
            <Body variant="step">{error.message}</Body>
          ) : answer ? (
            <Body variant="step">{answer}</Body>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {!isPending && error?.canRetry && (
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                // Retry unmounts itself as the error clears, and focus would
                // fall to the page. Close stays, so focus goes there first.
                closeRef.current?.focus()
                onRetry()
              }}
            >
              {t('retry')}
            </Button>
          )}
          <Button ref={closeRef} variant="ghost" size="lg" onClick={onClose}>
            {t('close')}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface ToggleStepsProps {
  steps: string[]
  doneSteps?: ReadonlySet<number>
  currentStep: number
  onToggleStep: (index: number) => void
  cookQuestion?: CookQuestionControls
}

/**
 * The generated steps as toggles (HON-933), each with an Ask button beside it
 * when the caller passes `cookQuestion` (HON-969). The Ask button is the
 * toggle's sibling, never inside it: a button inside a button is invalid.
 */
function ToggleSteps({
  steps,
  doneSteps,
  currentStep,
  onToggleStep,
  cookQuestion,
}: ToggleStepsProps) {
  const t = useTranslations('meal-plan.cookQuestion')
  const panelIdPrefix = useId()
  const askButtons = useRef(new Map<number, HTMLButtonElement>())
  // Set when Ask opens a panel while another one is open: the old panel's
  // field unmounts, so focus moves into the new one's.
  const [focusField, setFocusField] = useState(false)

  const closePanel = (index: number) => {
    cookQuestion?.onClose()
    askButtons.current.get(index)?.focus()
  }

  return (
    // The row's padding sits outside the text's column, so the numerals line
    // up with the heading above as the static list does.
    <div className="-mx-3">
      <Ol variant="steps">
        {steps.map((step, i) => {
          const open = cookQuestion?.openStep === i
          const panelId = `${panelIdPrefix}-panel-${i}`
          return (
            <Li key={i}>
              <div className="flex items-start gap-1">
                <StepToggle
                  step={step}
                  index={i}
                  done={doneSteps?.has(i) ?? false}
                  current={i === currentStep}
                  onToggle={onToggleStep}
                />
                {cookQuestion && (
                  <Button
                    ref={(el) => {
                      if (el) askButtons.current.set(i, el)
                      else askButtons.current.delete(i)
                    }}
                    variant="ghost"
                    size="icon-lg"
                    aria-label={t('askAboutStep', { n: i + 1 })}
                    aria-expanded={open}
                    aria-controls={open ? panelId : undefined}
                    onClick={() => {
                      if (open) {
                        closePanel(i)
                        return
                      }
                      setFocusField(cookQuestion.openStep !== null)
                      cookQuestion.onOpenStep(i)
                    }}
                  >
                    <MessageCircleQuestion aria-hidden="true" />
                  </Button>
                )}
              </div>
              {cookQuestion && open && (
                <CookQuestionPanel
                  id={panelId}
                  stepIndex={i}
                  steps={steps}
                  controls={cookQuestion}
                  focusField={focusField}
                  onClose={() => closePanel(i)}
                />
              )}
            </Li>
          )
        })}
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
  cookQuestion,
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
            <ToggleSteps
              steps={tips.steps}
              doneSteps={doneSteps}
              currentStep={currentStep}
              onToggleStep={onToggleStep}
              cookQuestion={cookQuestion}
            />
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

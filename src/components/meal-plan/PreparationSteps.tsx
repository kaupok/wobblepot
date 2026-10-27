'use client'

import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { Body, Heading, Li, Ol, Ul } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, prefersReducedMotion } from '@/lib/utils'
import type { PreparationSteps as PreparationStepsData } from '@/components/meal-plan/types'
import type {
  CookQuestionActive,
  CookQuestionAskInput,
  CookQuestionError,
} from '@/hooks/use-cook-question'
import { sameSubject, type CookQuestionSubject } from '@/lib/ai/cook-question-subject'
import { COOK_QUESTION_EQUIPMENT_MAX_ITEMS } from '@/lib/ai/cook-question-limits'
import { CookQuestionMenu, type CookQuestionMenuProps } from './CookQuestionMenu'
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

/**
 * The cook-question state, owned by the modal through `useCookQuestionPanel`,
 * so this component stays presentational.
 */
export interface CookQuestionControls {
  /**
   * The step or the item in "You'll need" whose panel is open: one at a time
   * across both sections (HON-983)
   */
  openSubject: CookQuestionSubject | null
  onOpenSubject: (subject: CookQuestionSubject) => void
  onClose: () => void
  ask: (input: CookQuestionAskInput) => void
  active: CookQuestionActive | null
  /** The answered question still on screen while `active` waits (HON-978) */
  previous: CookQuestionActive | null
  /** Waiting for the first words of the answer */
  isPending: boolean
  /** The answer's words are arriving; true until the stream closes (HON-979) */
  isStreaming: boolean
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
  /** The step or the item in "You'll need" this panel asks about */
  subject: CookQuestionSubject
  steps: string[]
  equipment: string[]
  controls: CookQuestionControls
  /** The panel's field and Close, which the ⋯ menu focuses after a pick */
  inputRef: RefObject<HTMLInputElement | null>
  closeRef: RefObject<HTMLButtonElement | null>
  /**
   * Close the panel and return focus to its ⋯ button. `byPointer` is true
   * when a tap or a click on Close did it, not a key.
   */
  onClose: (byPointer?: boolean) => void
}

/**
 * The question panel under one step (HON-969), or under one item in "You'll
 * need" with its own placeholder (HON-983). The row's ⋯ menu opens it with a
 * ready-made question already sent, or with the field alone (HON-1350). It
 * reads top to bottom in the order things happen (HON-1022). Before a
 * question: a field with Send, and a footer row with Close. Once a question
 * is sent the panel reads: the question asked, with Edit after it (HON-976);
 * the answer or the error; a field for a
 * follow-up; the footer row with "Thinking…" or Retry at its start and Close
 * at its end, so Close never moves. The answer streams in, and a stream that
 * breaks keeps its words with the error under them (HON-979). A second
 * question keeps the first one's answer, muted, until its own answer takes
 * that place, so the steps below do not jump (HON-978).
 * It sits straight on the tint, indented to the row's text, with no card or
 * border of its own (docs/DESIGN.md → cook view). It scrolls into view when it
 * opens, and the answer with Close does when it arrives (HON-977), so a step
 * low in the view never answers below the fold.
 */
function CookQuestionPanel({
  id,
  subject,
  steps,
  equipment,
  controls,
  inputRef,
  closeRef,
  onClose,
}: CookQuestionPanelProps) {
  const t = useTranslations('meal-plan.cookQuestion')
  const [text, setText] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  // Counts Edit presses: the field gets focus once the question is in it, with
  // the caret after the text, ready to change the end of it. A count, not a
  // flag on `text`, so a second Edit with the text unchanged still focuses.
  const [editCount, setEditCount] = useState(0)
  const questionId = useId()
  const { ask, active, previous, isPending, isStreaming, error, onRetry } = controls
  // Until the stream closes: a second question while the answer is on its way
  // would bill a second AI call, because the route runs on after the browser
  // aborts the first.
  const busy = isPending || isStreaming
  const isStep = subject.kind === 'step'
  const own = active && sameSubject(active.subject, subject) ? active : null
  // A question went out from this panel: the question, its answer and a
  // follow-up field show. Closing the panel discards the question (HON-978).
  const sent = own !== null || error !== null
  // The last answer, kept on screen under its own question while the next one
  // is on its way, so the panel does not shrink to one line (HON-978).
  const stale = own && isPending && sameSubject(previous?.subject, subject) ? previous : null
  const asked = stale ? stale.question : own ? own.question : null
  const answer = own ? own.answer : null
  // One slot for the stale answer or the answer, so each replaces the last in
  // place. The error goes under it: alone, or under the words that arrived
  // before the stream broke (HON-979).
  const shown = isPending ? stale?.answer : answer
  const shownError = isPending ? null : error?.message
  const hasAnswer = Boolean(answer)

  // Opened under a step low in the view, the question and field show at once.
  useEffect(() => {
    scrollIntoViewNearest(panelRef.current)
  }, [])

  // The answer or the error, with the field and Close under it, once the wait
  // is over. Not "Thinking…": the field the cook may be typing in stays where
  // it is. At the first words and again when the stream closes, not at every
  // chunk.
  useEffect(() => {
    if (!isPending && (hasAnswer || error)) scrollIntoViewNearest(resultRef.current)
  }, [isPending, isStreaming, hasAnswer, error])

  useEffect(() => {
    const input = inputRef.current
    if (editCount === 0 || !input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [editCount, inputRef])

  const send = (question: string, source: CookQuestionAskInput['source']) =>
    ask({ subject, steps, equipment, question, source })

  return (
    <div
      ref={panelRef}
      id={id}
      role="group"
      aria-label={
        isStep
          ? t('askAboutStep', { n: subject.index + 1 })
          : t('askAboutItem', { item: equipment[subject.index] ?? '' })
      }
      // A step's panel is indented to the step text, past the numeral; an
      // item's text starts at the list's edge, so its panel does too. Both end
      // at the ⋯ buttons' edge.
      className={cn('flex flex-col gap-3 pt-1 pb-2', isStep && 'pl-15 lg:pl-16')}
    >
      {/* What was asked, so a ready-made question's answer has its question
          and a typed one can be changed and sent again (HON-976). Outside the
          status region: the cook just asked it, so announcing it again adds
          nothing. Edit follows the question's text, not the row's far end. */}
      {asked && (
        <div className="flex flex-wrap items-center gap-x-1">
          <div className="min-w-0">
            <Body variant="step-small" tone="muted" id={questionId}>
              {t('youAsked', { question: asked })}
            </Body>
          </div>
          <Button
            variant="ghost"
            size="lg"
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
      {/* One box for the answer and everything under it, so one scroll brings
          the answer and Close into view (HON-977). */}
      <div ref={resultRef} data-slot="cook-question-result" className="flex flex-col">
        {/* Mounted from the start, as a live region must be; it takes space
            only once it holds an answer or an error. Busy while the words
            arrive, so a screen reader reads the finished answer once rather
            than every chunk (HON-979). */}
        <div role="status" aria-busy={isStreaming}>
          {/* Rendered only with something in it, so before a question the
              field sits at the panel's top. A new box rather than a
              class toggled on the region, which reduced motion's
              all-property transition would lag by a frame. */}
          {(shown || shownError) && (
            <div className="flex flex-col gap-3 pb-3">
              {shown && (
                <Body variant="step" tone={isPending ? 'muted' : 'default'}>
                  {shown}
                </Body>
              )}
              {shownError && <Body variant="step">{shownError}</Body>}
            </div>
          )}
          {/* Read out here; shown in the footer row, where it adds no line
              under the old answer (HON-978). */}
          {isPending && <span className="sr-only">{t('thinking')}</span>}
        </div>
        <div className="flex flex-col gap-3">
          {/* A form, so Enter in the field sends (.claude/rules/client-data.md → Form Handling). */}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              // `aria-disabled`, not `disabled`, keeps focus on Send while the
              // answer is on its way (docs/DESIGN.md → Focus management).
              if (busy) return
              const question = text.trim()
              if (!question) return
              send(question, 'text')
              setText('')
            }}
          >
            {/* `lg`, as Send is, so the two line up and the text is 16px at
                every width. */}
            <Input
              ref={inputRef}
              size="lg"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // The dialog leaves Escape in a text field to the field.
                if (e.key === 'Escape') onClose()
              }}
              aria-label={t('questionLabel')}
              placeholder={t(
                sent ? 'followUpPlaceholder' : isStep ? 'placeholder' : 'equipmentPlaceholder',
              )}
              maxLength={300}
              enterKeyHint="send"
            />
            <Button type="submit" size="lg" aria-disabled={busy}>
              {t('send')}
            </Button>
          </form>
          {/* The footer row: the wait or Retry at the start, Close at the end,
              under Send, in every state. */}
          <div className="flex flex-wrap items-center gap-2">
            {isPending && (
              <Body variant="step" tone="muted" aria-hidden>
                {t('thinking')}
              </Body>
            )}
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
            <Button
              ref={closeRef}
              variant="ghost"
              size="lg"
              className="ml-auto"
              // `detail` counts clicks; Enter and Space on a button leave it 0.
              onClick={(e) => onClose(e.detail > 0)}
            >
              {t('close')}
            </Button>
          </div>
        </div>
      </div>
    </div>
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
      panelId: panelId(index),
      quietFocus,
      // Opening resets the question on screen, so a pick on an open row
      // replaces it, as a question from another row would.
      onAsk: (question) => {
        if (!cookQuestion) return
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
    // line up with the heading above as the static list does. The right edge
    // stays the column's, so the ⋯ buttons end where the ones in "You'll
    // need" do (HON-1022).
    <div className="-ml-3">
      <Ol variant="steps">
        {steps.map((step, i) => (
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

'use client'

import { Pencil, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type RefObject, useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Body } from '@/components/ui/typography'
import type {
  CookQuestionActive,
  CookQuestionAskInput,
  CookQuestionError,
} from '@/hooks/use-cook-question'
import { type CookQuestionSubject, sameSubject } from '@/lib/ai/cook-question-subject'
import { cn, scrollIntoViewNearest } from '@/lib/utils'

/**
 * The cook-question state, owned by the modal through `useCookQuestionPanel`,
 * so the steps stay presentational.
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

export interface CookQuestionPanelProps {
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
 * ready-made question already sent, or with the field alone (HON-1350).
 *
 * It is one borderless card on the chip colour at half strength, so an answer
 * never reads as more steps (HON-1371). It reads top to bottom in the order
 * things happen (HON-1022). Its top row ends in the × Close in every state.
 * Before a question: × alone, then the field and Send. Once a question is
 * sent: the question asked, with the pencil Edit before × (HON-976), and
 * "Thinking…" in the pencil's place while the answer is on its way; the
 * answer or the error, one size below the step text, with Retry under the
 * error; a field for a follow-up. The answer streams in, and a stream that breaks keeps its words
 * with the error under them (HON-979). A second question keeps the first
 * one's answer, muted, until its own answer takes that place, so the steps
 * below do not jump (HON-978). It scrolls into view when it opens, and the
 * answer with the field does when it arrives (HON-977), so a step low in the
 * view never answers below the fold.
 */
export function CookQuestionPanel({
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
  const canRetry = !isPending && error?.canRetry === true

  // Opened under a step low in the view, the question and field show at once.
  useEffect(() => {
    scrollIntoViewNearest(panelRef.current)
  }, [])

  // The answer or the error, with the field under it, once the wait is over.
  // Not "Thinking…": the field the cook may be typing in stays where it is.
  // At the first words and again when the stream closes, not at every chunk.
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
      // The card's text starts where the row's text does: past the numeral
      // for a step, at the list's edge for an item. Its × ends on the ⋯
      // buttons' edge. The card itself bleeds by its padding on both sides
      // (`-mx-3`), as the current step's chip does, so the field keeps the
      // width it had before the card (HON-1371).
      className={cn('-mx-3 pt-1 pb-3', isStep && 'pl-15 lg:pl-16')}
    >
      <Card bordered={false} surface="chip" size="sm">
        <CardContent className="flex flex-col gap-2 px-3">
          {/* The top row, in every state, so × keeps one place: what was
              asked, so a ready-made question's answer has its question and a
              typed one can be changed and sent again (HON-976), then the
              pencil, then × at the card's top-right. The question is outside
              the status region: the cook just asked it, so announcing it
              again adds nothing. Before a question the row holds × alone, so
              the field keeps the card's full width at 390px. */}
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              {asked && (
                <Body variant="step-small" tone="muted" id={questionId}>
                  {t('youAsked', { question: asked })}
                </Body>
              )}
            </div>
            {/* The wait takes the pencil's place, in a row as tall as its
                buttons, so a follow-up adds no line under the old answer and
                the steps below stay put (HON-978). */}
            {isPending ? (
              <div className="shrink-0 px-2">
                <Body variant="step-small" tone="muted" aria-hidden>
                  {t('thinking')}
                </Body>
              </div>
            ) : (
              asked && (
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label={t('editQuestion')}
                  aria-describedby={questionId}
                  onClick={() => {
                    setText(asked)
                    setEditCount((n) => n + 1)
                  }}
                >
                  <Pencil aria-hidden="true" />
                </Button>
              )
            )}
            <Button
              ref={closeRef}
              variant="ghost"
              size="icon-lg"
              aria-label={t('close')}
              // `detail` counts clicks; Enter and Space on a button leave it 0.
              onClick={(e) => onClose(e.detail > 0)}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          {/* One box for the answer and everything under it, so one scroll
              brings the answer and the field into view (HON-977). */}
          <div ref={resultRef} data-slot="cook-question-result" className="flex flex-col gap-2">
            {/* Mounted from the start, as a live region must be; it takes
                space only once it holds an answer or an error. Busy while the
                words arrive, so a screen reader reads the finished answer
                once rather than every chunk (HON-979). */}
            <div role="status" aria-busy={isStreaming}>
              {/* Rendered only with something in it, so before a question
                  the field sits under the top row. A new box rather than a
                  class toggled on the region, which reduced motion's
                  all-property transition would lag by a frame. */}
              {(shown || shownError) && (
                <div className="flex flex-col gap-2">
                  {shown && (
                    <Body variant="step-small" tone={isPending ? 'muted' : 'default'}>
                      {shown}
                    </Body>
                  )}
                  {shownError && <Body variant="step-small">{shownError}</Body>}
                </div>
              )}
              {/* Read out here; shown in the top row, out of the region. */}
              {isPending && <span className="sr-only">{t('thinking')}</span>}
            </div>
            {canRetry && (
              <div>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    // Retry unmounts itself as the error clears, and focus
                    // would fall to the page. Close stays, so focus goes there
                    // first.
                    closeRef.current?.focus()
                    onRetry()
                  }}
                >
                  {t('retry')}
                </Button>
              </div>
            )}
            {/* A form, so Enter in the field sends (.claude/rules/client-data.md → Form Handling). */}
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                // `aria-disabled`, not `disabled`, keeps focus on Send while
                // the answer is on its way (docs/DESIGN.md → Focus management).
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
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

'use client'

import { useId, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Body } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'
import { ADJUST_INSTRUCTION_MAX_LENGTH } from '@/lib/meal-planning/components-schema'
import { buildChangeSet, type AdjustProposal } from '@/lib/meal-planning/adjust-proposal'
import { AdjustReviewDialog } from './AdjustReviewDialog'
import { useAdjustRecipe } from './use-adjust-recipe'
import type { EntryChange, MealComponent } from './types'

interface AdjustRecipeProps {
  planId: string
  entryId: string
  /** The entry's stored changes, which the new set keeps unless a proposal supersedes one. */
  changes: EntryChange[]
  /** The entry's merged components, as the ingredient list shows them. */
  components: MealComponent[]
  /** The stored instruction the steps follow, one request per line. */
  adjustmentNote: string | null
  /** The changes landed, and the server dropped the entry's cached steps. */
  onChanged?: () => void
}

/**
 * "Adjust recipe" on a planned entry (HON-1244): the household says what to
 * change, the AI proposes ingredient changes, and the review dialog applies
 * the ones it keeps. An instruction that needs no change says so here and
 * writes nothing. One the steps should follow with no ingredient change ("less
 * salt") is offered for the steps alone; the stored request shows here, with
 * Clear.
 */
export function AdjustRecipe({
  planId,
  entryId,
  changes,
  components,
  adjustmentNote,
  onChanged,
}: AdjustRecipeProps) {
  const t = useTranslations('meal-plan.adjust')
  const fieldId = useId()
  const { propose, isProposing, proposeError, resetProposal, apply, isApplying } = useAdjustRecipe({
    planId,
    entryId,
    onChanged,
  })
  const [instruction, setInstruction] = useState('')
  const [review, setReview] = useState<{ instruction: string; proposals: AdjustProposal[] }>({
    instruction: '',
    proposals: [],
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  // An answer with no change: `steps` when the steps can still follow it.
  const [empty, setEmpty] = useState<{ instruction: string; steps: boolean } | null>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  // The button is disabled while the AI answers, so focus returns to it when
  // the answer is an error or "no change" (docs/DESIGN.md → Focus management).
  const { ref: submitRef, requestRefocus } = useRefocusAfterPending(isProposing)

  const text = instruction.trim()
  // The review's search marks these as added, as the manual dialog does: the
  // meal's ingredients now, and the left-out ones, which come back by Undo.
  const existingIngredientIds = [
    ...components.map((c) => c.ingredientId),
    ...changes.flatMap((c) => (c.original ? [c.original.id] : [])),
  ]

  // The stored changes as they are, for a write that only moves the request.
  const storeNote = async (note: string | null, mode: 'append' | 'replace') => {
    const stored = await apply(
      buildChangeSet(changes, []),
      changes.map((c) => c.id),
      note,
      mode,
    )
    if (stored) {
      setEmpty(null)
      if (mode === 'append') setInstruction('')
      fieldRef.current?.focus()
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!text || isProposing) return
    setEmpty(null)
    const response = await propose(text)
    if (!response || response.changes.length === 0) {
      if (response) setEmpty({ instruction: text, steps: response.followInSteps })
      requestRefocus()
      return
    }
    setReview({ instruction: text, proposals: response.changes })
    setDialogOpen(true)
  }

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Label htmlFor={fieldId}>{t('label')}</Label>
        {adjustmentNote && (
          <div className="flex flex-wrap items-center gap-2">
            <Body variant="muted">
              {t('noteLabel', { note: adjustmentNote.split('\n').join(' · ') })}
            </Body>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={isApplying}
              onClick={() => void storeNote(null, 'replace')}
            >
              {t('clearNote')}
            </Button>
          </div>
        )}
        <Body variant="muted" id={`${fieldId}-hint`}>
          {t('hint')}
        </Body>
        <Textarea
          ref={fieldRef}
          id={fieldId}
          value={instruction}
          onChange={(e) => {
            setInstruction(e.target.value)
            setEmpty(null)
            resetProposal()
          }}
          placeholder={t('placeholder')}
          aria-describedby={`${fieldId}-hint`}
          maxLength={ADJUST_INSTRUCTION_MAX_LENGTH}
          rows={2}
          className="resize-none"
          disabled={isProposing}
        />
        {proposeError && <FieldError>{proposeError}</FieldError>}
        {empty && (
          <Body variant="muted" role="status">
            {empty.steps ? t('stepsOnly') : t('noChanges')}
          </Body>
        )}
        {empty?.steps && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full md:w-auto md:self-start"
            disabled={isApplying}
            onClick={() => void storeNote(empty.instruction, 'append')}
          >
            {t('useInSteps')}
          </Button>
        )}
        <Button
          ref={submitRef}
          type="submit"
          variant="outline"
          size="lg"
          className="w-full md:w-auto md:self-start"
          disabled={!text || isProposing}
        >
          {isProposing ? (
            <>
              <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
              {t('suggesting')}
            </>
          ) : (
            <>
              <Sparkles aria-hidden="true" className="mr-2 h-4 w-4" />
              {t('submit')}
            </>
          )}
        </Button>
      </form>

      {/* Outside the form: a portal leaves the form's DOM, but not React's tree. */}
      <AdjustReviewDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        instruction={review.instruction}
        proposals={review.proposals}
        changes={changes}
        existingIngredientIds={existingIngredientIds}
        isApplying={isApplying}
        onApply={async (set) => {
          const applied = await apply(
            set,
            changes.map((c) => c.id),
            review.instruction,
          )
          if (applied) setInstruction('')
          return applied
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          fieldRef.current?.focus()
        }}
      />
    </>
  )
}

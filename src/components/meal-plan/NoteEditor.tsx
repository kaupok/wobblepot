'use client'

import { useState, useRef, useEffect, useCallback, useImperativeHandle, type Ref } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'
import { StickyNote } from './StickyNote'

const MAX_NOTE_LENGTH = 200
/** The counter stays hidden until the note is 80% of the way to the cap. */
const COUNTER_THRESHOLD = 160

/** Lets a parent place focus once whatever opened or closed the editor is done moving it. */
export interface NoteEditorHandle {
  /**
   * Focuses what the editor shows: the textarea while editing, else the saved
   * note. False when there is nothing to focus (no note, editor closed).
   */
  focus: () => boolean
}

interface NoteEditorProps {
  ref?: Ref<NoteEditorHandle>
  planId: string
  entryId: string
  note: string | null
  onNoteChange?: (note: string | null) => void
  /**
   * One-line textarea that stops growing at two lines and scrolls, so the
   * editor stays inside the card it lies on (HON-974).
   */
  compact?: boolean
  /**
   * The saved note shows at most three lines. For a slip laid over a planner
   * card, which has a fixed height to fit in (HON-974); the button's
   * accessible name is still the whole note, and the editor shows it all.
   */
  clamped?: boolean
  /**
   * Size of the editor's buttons (Add note, Cancel, Save). `sm` on a meal
   * card, where 44px zones would crowd the row; `lg` in the cook view, which
   * is tapped from a counter (HON-932).
   */
  size?: 'sm' | 'lg'
  className?: string
  /** Controlled editing state (optional — uncontrolled by default) */
  isEditing?: boolean
  /** Callback when editing state changes (required when `isEditing` is controlled) */
  onEditingChange?: (editing: boolean) => void
}

export function NoteEditor({
  ref,
  planId,
  entryId,
  note,
  onNoteChange,
  compact = false,
  clamped = false,
  size = 'sm',
  className,
  isEditing: controlledIsEditing,
  onEditingChange,
}: NoteEditorProps) {
  const t = useTranslations('meal-plan.noteEditor')
  const [uncontrolledIsEditing, setUncontrolledIsEditing] = useState(false)
  const isControlled = controlledIsEditing !== undefined
  const isEditing = isControlled ? controlledIsEditing : uncontrolledIsEditing

  function setIsEditing(value: boolean) {
    if (isControlled) {
      onEditingChange?.(value)
    } else {
      setUncontrolledIsEditing(value)
    }
  }
  const [editValue, setEditValue] = useState(note ?? '')

  const saveMutation = useMutation({
    mutationFn: (newNote: string | null) =>
      apiFetch(
        `/api/meal-plans/${planId}/entries/${entryId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: newNote }),
        },
        t('saveFailed'),
      ),
    onSuccess: (_data, newNote) => {
      onNoteChange?.(newNote)
      setIsEditing(false)
    },
    // The server's error prose is English; the localized copy is always shown.
    onError: () => toast.error(t('saveFailed')),
  })
  const isSaving = saveMutation.isPending
  // The textarea is disabled while saving, which drops focus to the body; a
  // failed save hands it back so the note can be retried (CLAUDE.md → Focus
  // management).
  const { ref: inputRef, requestRefocus } = useRefocusAfterPending<HTMLTextAreaElement>(isSaving)
  const noteButtonRef = useRef<HTMLButtonElement>(null)

  // Sync editValue when entering edit mode (handles external trigger via controlled state).
  // Adjusted during render rather than in an effect (`react-hooks/set-state-in-effect`).
  const [syncedFrom, setSyncedFrom] = useState({ isEditing, note })
  if (syncedFrom.isEditing !== isEditing || syncedFrom.note !== note) {
    setSyncedFrom({ isEditing, note })
    if (isEditing) {
      setEditValue(note ?? '')
    }
  }

  const focusInput = useCallback(() => {
    const input = inputRef.current
    if (!input) return false
    input.focus()
    // Move cursor to end
    input.setSelectionRange(input.value.length, input.value.length)
    return true
  }, [inputRef])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (focusInput()) return true
        noteButtonRef.current?.focus()
        return noteButtonRef.current != null
      },
    }),
    [focusInput],
  )

  // Focus input when entering edit mode. This owns focus for the openers that
  // are done with it by then (the slip, "Add note"); a parent whose opener
  // still moves focus afterwards (a closing menu) focuses again through `ref`.
  useEffect(() => {
    if (isEditing) focusInput()
  }, [isEditing, focusInput])

  function handleSave() {
    const trimmedValue = editValue.trim()
    const newNote = trimmedValue || null

    // No change
    if (newNote === note) {
      setIsEditing(false)
      return
    }

    saveMutation.mutate(newNote, {
      // Only if focus is still where the save left it: the user may have
      // moved on while the request was in flight.
      onError: () => {
        const focused = document.activeElement
        if (!focused || focused === document.body || focused === inputRef.current) {
          requestRefocus()
        }
      },
    })
  }

  function handleCancel() {
    setEditValue(note ?? '')
    setIsEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  // Editing mode: the same slip, straightened. The textarea is bare — no
  // border, fill or ring — and takes the slip's text colour and type, so the
  // slip's focus-within outline is the only one (docs/DESIGN.md → "Notes are
  // sticky notes"). It grows with the text; `rows` is the fallback where
  // `field-sizing` is unsupported.
  if (isEditing) {
    const showCounter = editValue.length > COUNTER_THRESHOLD
    return (
      <StickyNote variant="editing" className={className}>
        <textarea
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value.slice(0, MAX_NOTE_LENGTH))}
          onKeyDown={handleKeyDown}
          aria-label={t('ariaLabel')}
          placeholder={t('placeholder')}
          rows={compact ? 1 : 2}
          className={cn(
            'placeholder:text-muted-foreground field-sizing-content w-full resize-none bg-transparent text-sm leading-normal outline-none disabled:cursor-not-allowed disabled:opacity-50',
            compact && 'max-h-12 overflow-y-auto',
          )}
          disabled={isSaving}
        />
        <div className="flex items-center justify-end gap-1">
          {showCounter && (
            <div className="mr-auto">
              <Body variant="caption">
                {editValue.length}/{MAX_NOTE_LENGTH}
              </Body>
            </div>
          )}
          <Button variant="ghost" size={size} onClick={handleCancel} disabled={isSaving}>
            {t('cancel')}
          </Button>
          <Button variant="default" size={size} onClick={handleSave} disabled={isSaving}>
            {isSaving ? t('saving') : t('save')}
          </Button>
        </div>
      </StickyNote>
    )
  }

  // Display mode with note: the slip is the button. A native button rather
  // than `Button`: a note runs to 200 characters and wraps, which every
  // fixed-height `Button` size would overflow. Its accessible name is the
  // note text.
  if (note) {
    return (
      <StickyNote asChild variant="interactive" className={className}>
        <button
          ref={noteButtonRef}
          type="button"
          onClick={() => {
            setEditValue(note)
            setIsEditing(true)
          }}
        >
          {clamped ? (
            <span className="line-clamp-3">
              <Body variant="paragraph">{note}</Body>
            </span>
          ) : (
            <Body variant="paragraph">{note}</Body>
          )}
        </button>
      </StickyNote>
    )
  }

  // Display mode without note
  // When controlled externally, render nothing (trigger is in the parent)
  if (isControlled) return null

  // Uncontrolled: show add button
  return (
    <Button
      variant="quiet"
      size={size}
      onClick={() => setIsEditing(true)}
      className={cn('self-start', className)}
    >
      <Plus aria-hidden="true" />
      {t('addNote')}
    </Button>
  )
}

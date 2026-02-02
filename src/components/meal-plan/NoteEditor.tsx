'use client'

import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'

const MAX_NOTE_LENGTH = 200

interface NoteEditorProps {
  planId: string
  entryId: string
  note: string | null
  onNoteChange?: (note: string | null) => void
  compact?: boolean
  className?: string
}

export function NoteEditor({
  planId,
  entryId,
  note,
  onNoteChange,
  compact = false,
  className,
}: NoteEditorProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(note ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      // Move cursor to end
      inputRef.current.setSelectionRange(editValue.length, editValue.length)
    }
  }, [isEditing, editValue.length])

  async function handleSave() {
    const trimmedValue = editValue.trim()
    const newNote = trimmedValue || null

    // No change
    if (newNote === note) {
      setIsEditing(false)
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: newNote }),
      })

      if (!response.ok) {
        toast.error('Failed to save note')
        return
      }

      onNoteChange?.(newNote)
      setIsEditing(false)
    } catch {
      toast.error('Failed to save note')
    } finally {
      setIsSaving(false)
    }
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

  // Editing mode
  if (isEditing) {
    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        <textarea
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value.slice(0, MAX_NOTE_LENGTH))}
          onKeyDown={handleKeyDown}
          aria-label="Meal note"
          placeholder="Add a note..."
          rows={compact ? 1 : 2}
          className={cn(
            'border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full resize-none rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
            compact && 'text-xs',
          )}
          disabled={isSaving}
        />
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">
            {editValue.length}/{MAX_NOTE_LENGTH}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Display mode with note
  if (note) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditValue(note)
          setIsEditing(true)
        }}
        className={cn(
          'text-muted-foreground hover:text-foreground w-full cursor-pointer text-left transition-colors',
          className,
        )}
      >
        <Body variant="muted" className={cn('italic', compact && 'text-xs')}>
          {note}
        </Body>
      </button>
    )
  }

  // Display mode without note - show add button
  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className={cn(
        'text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors',
        className,
      )}
    >
      <span className="text-sm">+</span>
      <span>Add note</span>
    </button>
  )
}

'use client'

import { type ComponentProps, useRef, useState } from 'react'

import { IngredientChangeDialog } from './IngredientChangeDialog'
import { type IngredientChangeControls, IngredientList } from './IngredientList'
import type { MealComponent } from './types'
import { useEntryChanges } from './use-entry-changes'

interface EditableIngredientListProps extends Omit<
  ComponentProps<typeof IngredientList>,
  'changeControls'
> {
  planId: string
  entryId: string
  /** A planned entry. A cooked or skipped one shows its changes read-only. */
  editable: boolean
  /** A change or an undo landed, and the server dropped the entry's cached steps. */
  onChanged?: () => void
}

/**
 * The cook view's ingredient list for one plan entry, with the controls that
 * change this entry's ingredients only (HON-1243): Replace and Leave out on
 * each row, "Add an ingredient", and Undo on a changed row.
 */
export function EditableIngredientList({
  planId,
  entryId,
  editable,
  onChanged,
  ...listProps
}: EditableIngredientListProps) {
  const { addChange, undoChange, isAdding, undoingId } = useEntryChanges({
    planId,
    entryId,
    onChanged,
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  // Kept apart from `dialogOpen`, so the title does not flip while it closes.
  const [original, setOriginal] = useState<MealComponent | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const busy = isAdding || undoingId !== undefined

  // The row that held focus is replaced when the list comes back, so focus
  // goes to "Add an ingredient", which stays (docs/DESIGN.md → Focus management).
  const focusAdd = () => addButtonRef.current?.focus()

  const openDialog = (component: MealComponent | null) => {
    if (busy) return
    setOriginal(component)
    setDialogOpen(true)
  }

  const controls: IngredientChangeControls | undefined = editable
    ? {
        onReplace: openDialog,
        onAdd: () => openDialog(null),
        onLeaveOut: (component) => {
          if (busy) return
          void addChange({
            originalIngredientId: component.ingredientId,
            replacementIngredientId: null,
            quantityPerServing: null,
          }).then(focusAdd)
        },
        onUndo: (change) => {
          if (busy) return
          void undoChange(change.id).then(focusAdd)
        },
        undoingId,
        disabled: busy,
        addButtonRef,
      }
    : undefined

  // The search marks these as added: the meal's ingredients now, and the
  // left-out ones, which come back by Undo rather than by adding them again.
  const existingIngredientIds = [
    ...listProps.components.map((c) => c.ingredientId),
    ...(listProps.changes ?? []).flatMap((c) => (c.original ? [c.original.id] : [])),
  ]

  return (
    <>
      <IngredientList {...listProps} changeControls={controls} />
      {editable && (
        <IngredientChangeDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          original={original}
          servings={listProps.servings}
          existingIngredientIds={existingIngredientIds}
          isSubmitting={isAdding}
          onSubmit={(replacement, quantityPerServing) =>
            addChange({
              originalIngredientId: original?.ingredientId ?? null,
              replacementIngredientId: replacement.id,
              quantityPerServing,
            })
          }
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            focusAdd()
          }}
        />
      )}
    </>
  )
}

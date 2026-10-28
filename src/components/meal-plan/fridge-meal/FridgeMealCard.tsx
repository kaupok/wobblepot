'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Check, MoreHorizontal, Pencil, Undo2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Body, Heading, Li, Ul } from '@/components/ui/typography'
import type { MealType } from '@/generated/prisma/enums'
import { MealTypeBadge } from '../MealTypeBadge'
import { NoteEditor } from '../NoteEditor'
import { StickyNote } from '../StickyNote'
import { useClearEntry } from '../use-clear-entry'
import { useEntryStatus } from '../use-entry-status'
import type { FridgeMealItem, MealStatus, PantryItemFull } from '../types'
import { FridgeCompleteDialog } from './FridgeCompleteDialog'
import { FridgeMealPicker } from './FridgeMealPicker'
import { toFridgeItemInput, useFridgeItemText } from './use-fridge-item-text'

interface FridgeMealCardProps {
  entryId: string
  planId: string
  /** The entry's day, YYYY-MM-DD: Undo after Clear restores the entry to it. */
  date: string
  mealType: MealType
  status: MealStatus
  items: FridgeMealItem[]
  note?: string | null
  /** Kept for Undo after Clear: see `PlanEntry.noteX`. */
  noteX?: number | null
  noteY?: number | null
  /** The household's pantry, for the picker's search. */
  pantryItems: PantryItemFull[]
  /** The pantry was already marked for this entry — see `PlanEntry.pantryDeducted`. */
  pantryDeducted?: boolean
  /** Called once Clear has deleted the entry, so the page can focus the slot that replaces it. */
  onCleared?: () => void
}

/**
 * A planned fridge meal (HON-1277): the title and the items, which the
 * household edits until it marks the meal eaten. It has no recipe, so it has no
 * cook view, tips, cook questions or rating, and it adds nothing to the
 * shopping list or the nutrition.
 */
export function FridgeMealCard({
  entryId,
  planId,
  date,
  mealType,
  status: initialStatus,
  items,
  note: initialNote = null,
  noteX = null,
  noteY = null,
  pantryItems,
  pantryDeducted = false,
  onCleared,
}: FridgeMealCardProps) {
  const router = useRouter()
  const t = useTranslations('meal-plan.fridge')
  const tCard = useTranslations('meal-plan.card')
  const itemText = useFridgeItemText()
  const [note, setNote] = useState<string | null>(initialNote)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  // Both dialogs open from the ⋯ menu with no `DialogTrigger`, so each hands
  // focus back to the menu's trigger as it closes (docs/DESIGN.md → Focus management).
  const moreActionsTriggerRef = useRef<HTMLButtonElement>(null)

  const {
    status,
    isPantryCharged,
    isUpdating,
    isDeductionModalOpen: isCompleteOpen,
    setIsDeductionModalOpen: setIsCompleteOpen,
    handleStatusChange,
    completeFridgeMeal,
  } = useEntryStatus({
    planId,
    entryId,
    meal: null,
    initialStatus,
    pantryDeducted,
    servings: 0,
    pantryItems,
    source: 'meal_card',
  })
  // The title and the items, so two fridge cards on one page name their actions
  // apart. Separators, not prepositions (docs/LOCALIZATION.md).
  const cardName = t('cardName', { title: t('title'), items: items.map(itemText).join(', ') })
  const { clear, isClearing } = useClearEntry({ planId, entryId, name: cardName, onCleared })

  const hasPantryItems = items.some((item) => item.ingredientId !== null)
  const isCompleted = status === 'completed'
  const isBusy = isUpdating || isClearing

  function handleEaten() {
    if (isBusy) return
    // Nothing to tick, or the pantry was marked once already (HON-651): the
    // dialog would offer a change the server would not make.
    if (!hasPantryItems || isPantryCharged) {
      handleStatusChange('completed')
      return
    }
    setIsCompleteOpen(true)
  }

  function handleClear() {
    if (isBusy || isCompleted) return
    clear({
      date,
      mealType,
      fridgeItems: items.map(toFridgeItemInput),
      status,
      note,
      noteX: note ? noteX : null,
      noteY: note ? noteY : null,
    })
  }

  function focusMoreActionsOnClose(event: Event) {
    event.preventDefault()
    moreActionsTriggerRef.current?.focus()
  }

  return (
    <>
      <Card size="sm">
        <CardContent className="flex flex-col gap-1.5 px-4 pt-1 pb-2">
          <div className="flex items-center gap-2">
            <MealTypeBadge mealType={mealType} />
            {isCompleted && <Badge variant="surface">{t('eaten')}</Badge>}
          </div>
          {/* The actions sit on the title row behind one ⋯ menu, as on a
              recipe card (docs/DESIGN.md → Composition rules). */}
          <div className="flex items-center justify-between gap-2">
            <Heading variant="section" as="h3">
              {t('title')}
            </Heading>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={moreActionsTriggerRef}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={tCard('moreActions', { name: cardName })}
                >
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isCompleted ? (
                  <DropdownMenuItem
                    disabled={isBusy}
                    onSelect={() => handleStatusChange('planned')}
                  >
                    <Undo2 aria-hidden="true" />
                    {t('notEatenYet')}
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem disabled={isBusy} onSelect={handleEaten}>
                      <Check aria-hidden="true" />
                      {t('markEaten')}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={isBusy} onSelect={() => setIsPickerOpen(true)}>
                      <Pencil aria-hidden="true" />
                      {t('editItems')}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={isBusy} onSelect={handleClear}>
                      <X aria-hidden="true" />
                      {tCard('clear')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Ul variant="plain">
            {items.map((item) => (
              <Li key={item.id}>
                <Body variant="small">{itemText(item)}</Body>
              </Li>
            ))}
          </Ul>
          {isCompleted ? (
            note && (
              <StickyNote>
                <Body variant="paragraph">{note}</Body>
              </StickyNote>
            )
          ) : (
            <NoteEditor
              planId={planId}
              entryId={entryId}
              note={note}
              onNoteChange={setNote}
              compact
            />
          )}
        </CardContent>
      </Card>
      <FridgeMealPicker
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        planId={planId}
        entryId={entryId}
        date={date}
        mealType={mealType}
        initialItems={items}
        pantryItems={pantryItems}
        onSaved={() => router.refresh()}
        onCloseAutoFocus={focusMoreActionsOnClose}
      />
      <FridgeCompleteDialog
        open={isCompleteOpen}
        onOpenChange={setIsCompleteOpen}
        items={items}
        onConfirm={(ids) => completeFridgeMeal(ids, () => setIsCompleteOpen(false))}
        isLoading={isUpdating}
        onCloseAutoFocus={focusMoreActionsOnClose}
      />
    </>
  )
}

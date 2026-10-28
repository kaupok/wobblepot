'use client'

import { useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Check, MoreHorizontal, Pencil, StickyNote as StickyNoteIcon, Undo2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { CardContent, CardHeader } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Body, Heading } from '@/components/ui/typography'
import type { MealType } from '@/generated/prisma/enums'
import { cn } from '@/lib/utils'
import { CARD_CLICK_IGNORE } from '../card-click'
import { MEAL_IMAGE_BADGE_ROW_WIDTH, MealImageCard, mealImageTitleWidth } from '../MealImageCard'
import { MealTypeBadge } from '../MealTypeBadge'
import { NoteEditor } from '../NoteEditor'
import { StickyNote } from '../StickyNote'
import { useClearEntry } from '../use-clear-entry'
import { useEntryStatus } from '../use-entry-status'
import type { FridgeMealItem, MealStatus, PantryItemFull } from '../types'
import { FridgeCompleteDialog } from './FridgeCompleteDialog'
import { FridgeMealPicker } from './FridgeMealPicker'
import { toFridgeItemInput, useFridgeItemText, useLeftoverSourceText } from './use-fridge-item-text'

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

/** The items as a name: "Pasta, chickpeas", with the first letter in capitals. */
function capitalise(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)
}

/**
 * A planned fridge meal (HON-1277). The items are its name, so the card says
 * what the household eats, on the leftovers' meal's picture when it has one or
 * on the fixed fridge tint otherwise. A click opens the items, which the
 * household edits until it marks the meal eaten. It has no recipe, so it has
 * no cook view, tips, cook questions or rating, and it adds nothing to the
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
  const locale = useLocale()
  const t = useTranslations('meal-plan.fridge')
  const tCard = useTranslations('meal-plan.card')
  const itemText = useFridgeItemText()
  const leftoverSourceText = useLeftoverSourceText()
  const nameId = useId()
  const sidesId = useId()
  const sourceId = useId()
  const [note, setNote] = useState<string | null>(initialNote)
  const [isNoteEditing, setIsNoteEditing] = useState(false)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  // Both dialogs open with no `DialogTrigger`, so each hands focus back to the
  // control that opened it as it closes (docs/DESIGN.md → Focus management):
  // the ⋯ trigger, or the name for the picker opened from the card.
  const moreActionsTriggerRef = useRef<HTMLButtonElement>(null)
  const nameButtonRef = useRef<HTMLButtonElement>(null)
  const pickerOpenerRef = useRef<HTMLButtonElement | null>(null)

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
  // Leftovers lead: their meals are the name, and the rest sit under it as
  // "+ cucumber, sour cream". With no leftovers, every item is the name.
  const leftovers = items.filter((item) => item.sourceEntryId !== null)
  const sides = leftovers.length > 0 ? items.filter((item) => item.sourceEntryId === null) : []
  const name = capitalise(
    leftovers.length > 0
      ? leftovers.map((item) => item.name ?? itemText(item)).join(', ')
      : items.map(itemText).join(', '),
    locale,
  )
  // A leftover the assistant planned says which meal feeds it and how much,
  // so the household cooks enough (HON-1395).
  const sourceLines = leftovers.flatMap((item) => leftoverSourceText(item) ?? [])
  // The leftovers' meal was skipped or changed, so they will not exist. Only
  // while this meal is still to eat: the household must plan something else.
  const isLeftoverGone =
    status !== 'completed' && leftovers.some((item) => item.sourceState === 'gone')
  const nameLabelIds = [nameId, sourceLines.length > 0 && sourceId, sides.length > 0 && sidesId]
    .filter(Boolean)
    .join(' ')
  // The title and the items, so two fridge cards on one page name their actions
  // apart. Separators, not prepositions (docs/LOCALIZATION.md).
  const cardName = t('cardName', { title: t('title'), items: items.map(itemText).join(', ') })
  const { clear, isClearing } = useClearEntry({ planId, entryId, name: cardName, onCleared })
  // The leftovers' dish, when one has a picture: the card shows that meal
  // again. A picture with no hue still shows, on the neutral surface, as on a
  // recipe card (HON-754).
  const leftoverImage = items.find(
    (item) => item.image?.imageStatus === 'ready' && item.image.imageUrl,
  )?.image

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

  function openPicker(opener: React.RefObject<HTMLButtonElement | null>) {
    if (isBusy || isCompleted) return
    pickerOpenerRef.current = opener.current
    setIsPickerOpen(true)
  }

  // A click anywhere on a card that is not eaten opens its items, as a recipe
  // card opens the cook view (docs/DESIGN.md → "The whole planner card opens
  // the cook view"). Controls and the open note editor keep their own clicks.
  function handleCardClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return
    if (target.closest(CARD_CLICK_IGNORE)) return
    if (isNoteEditing && target.closest('[data-slot="meal-image-overlay"] *')) return
    if (window.getSelection()?.toString()) return
    nameButtonRef.current?.focus({ preventScroll: true })
    openPicker(nameButtonRef)
  }

  function focusMoreActionsOnClose(event: Event) {
    event.preventDefault()
    moreActionsTriggerRef.current?.focus()
  }

  function focusPickerOpenerOnClose(event: Event) {
    event.preventDefault()
    pickerOpenerRef.current?.focus()
  }

  return (
    <>
      <MealImageCard
        meal={{ ...leftoverImage, name }}
        // No leftovers' picture, or one that fails to load: the fixed fridge
        // tint, not the plain card.
        fallbackSurface="fridge"
        trailingActions
        size="sm"
        interactive={!isCompleted}
        onClick={isCompleted ? undefined : handleCardClick}
        head={
          <CardHeader className="px-4 pt-1 pb-1">
            <div className="flex min-h-8 min-w-0 items-center justify-between gap-1">
              <div
                className={cn(
                  'flex min-w-0 flex-wrap items-center gap-1.5',
                  MEAL_IMAGE_BADGE_ROW_WIDTH,
                )}
              >
                <MealTypeBadge mealType={mealType} />
                <Badge variant="surface">
                  {leftovers.length > 0 ? t('leftovers') : t('fromFridge')}
                </Badge>
              </div>
              {/* The actions sit on the title row behind one ⋯ menu, as on a
                  recipe card (docs/DESIGN.md → Composition rules). */}
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
                      <DropdownMenuItem disabled={isBusy} onSelect={() => setIsNoteEditing(true)}>
                        <StickyNoteIcon aria-hidden="true" />
                        {tCard('note')}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={isBusy} onSelect={handleEaten}>
                        <Check aria-hidden="true" />
                        {t('markEaten')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={isBusy}
                        onSelect={() => openPicker(moreActionsTriggerRef)}
                      >
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
            {/* The food is the name, at the recipe card's size and in its text
                block's minimum height, so the card is one height with the
                recipe cards around it (HON-1096). The button lies over the
                name, as on `MealCard`. */}
            <div
              className={cn(
                'flex min-h-14 min-w-0 flex-col @md/meal-image:min-h-26',
                mealImageTitleWidth(true),
              )}
            >
              <div className="relative flex min-h-8 w-fit items-center">
                <Heading variant="section" as="h3">
                  {!isCompleted && (
                    <button
                      ref={nameButtonRef}
                      type="button"
                      data-slot="card-target"
                      aria-labelledby={nameLabelIds}
                      className="absolute inset-0 cursor-pointer outline-none"
                      onClick={() => openPicker(nameButtonRef)}
                    />
                  )}
                  <span id={nameId} className="underline-offset-2 group-hover/card:underline">
                    {name}
                  </span>
                </Heading>
              </div>
              {sourceLines.length > 0 && (
                <div id={sourceId}>
                  {sourceLines.map((line) => (
                    <Body key={line} variant="paragraph" tone="muted">
                      {line}
                    </Body>
                  ))}
                </div>
              )}
              {sides.length > 0 && (
                <Body variant="paragraph" tone="muted" id={sidesId}>
                  {t('withItems', { items: sides.map(itemText).join(', ') })}
                </Body>
              )}
            </div>
            {/* Where a recipe card says what to buy: the reason to pick a
                fridge meal, or that it was eaten. */}
            <div
              className={cn(
                'flex min-h-6.5 min-w-0 flex-wrap items-center gap-1',
                MEAL_IMAGE_BADGE_ROW_WIDTH,
              )}
            >
              {isCompleted ? (
                <Badge variant="surface">{t('eaten')}</Badge>
              ) : (
                <Badge variant="surface-success">{t('nothingToBuy')}</Badge>
              )}
            </div>
          </CardHeader>
        }
        overlay={
          isCompleted
            ? note && (
                <StickyNote>
                  <div className="line-clamp-2">
                    <Body variant="paragraph">{note}</Body>
                  </div>
                </StickyNote>
              )
            : (!!note || isNoteEditing) && (
                <NoteEditor
                  planId={planId}
                  entryId={entryId}
                  note={note}
                  onNoteChange={setNote}
                  compact
                  clamped
                  isEditing={isNoteEditing}
                  onEditingChange={setIsNoteEditing}
                />
              )
        }
        overlayWide={isNoteEditing}
      >
        {isLeftoverGone && (
          <CardContent className="px-4 pb-2">
            <Callout tone="warning">{t('sourceGone')}</Callout>
          </CardContent>
        )}
      </MealImageCard>
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
        onCloseAutoFocus={focusPickerOpenerOnClose}
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

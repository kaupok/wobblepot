'use client'

import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Body, Heading } from '@/components/ui/typography'
import { ApiError, apiFetch } from '@/lib/api'
import { FRIDGE_ITEM_LABEL_MAX, FRIDGE_ITEMS_MAX } from '@/lib/meal-plans/fridge-items'
import type { RecentMeal } from '@/lib/meal-plans/recent-meals'
import type { MealType } from '@/generated/prisma/enums'
import type { FridgeMealItem, PantryItemFull } from '../types'
import { toFridgeItemInput, useFridgeItemText, type FridgeItemShown } from './use-fridge-item-text'

/** Pantry matches shown at once, so a full pantry does not push the rest away. */
const PANTRY_MATCHES_SHOWN = 8

/** The leftovers the picker offers. Fetched each time it opens. */
export const recentMealsQueryKey = ['recent-meals'] as const

interface FridgeMealPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planId: string
  date: string
  mealType: MealType
  /**
   * The entry the items replace: a fridge meal being edited, a planned recipe
   * or a note-only card. Absent creates the fridge meal in the open slot.
   */
  entryId?: string
  /** The items to start from, when editing. */
  initialItems?: FridgeMealItem[]
  /** The household's pantry, which the search filters. */
  pantryItems: PantryItemFull[]
  /** The items were saved. The caller refreshes the page. */
  onSaved: () => void
  /** Opened from state, so the caller returns focus to its opener (docs/DESIGN.md → Focus management). */
  onCloseAutoFocus?: (event: Event) => void
  /**
   * The household's own words from its fridge meals of the last 30 days, as
   * one-tap chips, so "Wolt" stays one label (HON-1383).
   */
  recentLabels?: string[]
  /**
   * A log on Past meals: the meal was already eaten, so the new entry is saved
   * as cooked, with no pantry change (HON-1383).
   */
  logPast?: boolean
}

/**
 * The fridge-meal picker (HON-1277): what the household has at home, from the
 * pantry, from a meal eaten in the last days, or in its own words. Items have
 * no quantities. Saving creates the entry, or replaces the items of the one
 * given.
 */
export function FridgeMealPicker({
  open,
  onOpenChange,
  onCloseAutoFocus,
  ...props
}: FridgeMealPickerProps) {
  const t = useTranslations('meal-plan.fridge')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('pickerDescription')}</DialogDescription>
        </DialogHeader>
        {/* Mounted with the content, so each open starts from the entry's items. */}
        <PickerForm {...props} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

type PickerFormProps = Omit<FridgeMealPickerProps, 'open' | 'onOpenChange' | 'onCloseAutoFocus'> & {
  onClose: () => void
}

/** An item in the picker, with a key that stays put while others are removed. */
type Draft = FridgeItemShown & { key: string }

let draftCounter = 0
const toDraft = (item: FridgeItemShown): Draft => ({
  ingredientId: item.ingredientId,
  sourceEntryId: item.sourceEntryId,
  label: item.label,
  name: item.name,
  sourceDate: item.sourceDate,
  key: `draft-${++draftCounter}`,
})

function PickerForm({
  planId,
  date,
  mealType,
  entryId,
  initialItems = [],
  pantryItems,
  onSaved,
  onClose,
  recentLabels = [],
  logPast = false,
}: PickerFormProps) {
  const t = useTranslations('meal-plan.fridge')
  const tCard = useTranslations('meal-plan.card')
  const itemText = useFridgeItemText()
  const searchId = useId()
  const freeTextId = useId()
  // A chip add unmounts the chip, so focus moves here instead of to `<body>`
  // (docs/DESIGN.md → Focus management).
  const searchRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Draft[]>(() => initialItems.map(toDraft))
  const [query, setQuery] = useState('')
  const [freeText, setFreeText] = useState('')
  const [showNeedsItem, setShowNeedsItem] = useState(false)

  const recentQuery = useQuery({
    queryKey: recentMealsQueryKey,
    queryFn: () => apiFetch<{ meals: RecentMeal[] }>('/api/entries/recent'),
  })

  const chosenIngredientIds = new Set(
    items.flatMap((i) => (i.ingredientId ? [i.ingredientId] : [])),
  )
  const chosenSourceIds = new Set(items.flatMap((i) => (i.sourceEntryId ? [i.sourceEntryId] : [])))
  const isFull = items.length >= FRIDGE_ITEMS_MAX

  // Quantity 0 is "ran out": not at home.
  const atHome = useMemo(() => pantryItems.filter((p) => p.quantity !== 0), [pantryItems])
  const pantryMatches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return [...atHome]
      .filter((p) => !needle || p.ingredient.name.toLocaleLowerCase().includes(needle))
      .sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name))
  }, [atHome, query])
  const shownPantry = pantryMatches
    .filter((p) => !chosenIngredientIds.has(p.ingredientId))
    .slice(0, PANTRY_MATCHES_SHOWN)
  const recentMeals = (recentQuery.data?.meals ?? []).filter((m) => !chosenSourceIds.has(m.entryId))
  const chosenLabels = new Set(items.flatMap((i) => (i.label ? [i.label.toLocaleLowerCase()] : [])))
  const shownLabels = recentLabels.filter((label) => !chosenLabels.has(label.toLocaleLowerCase()))

  function add(item: FridgeItemShown) {
    if (isFull) return
    setShowNeedsItem(false)
    setItems((current) => [...current, toDraft(item)])
  }

  /** The household's own words, as "Something else" and the no-match button add them. */
  function addLabel(text: string) {
    const label = text.trim().slice(0, FRIDGE_ITEM_LABEL_MAX)
    if (!label) return
    add({ ingredientId: null, sourceEntryId: null, label, name: null, sourceDate: null })
  }

  function addFreeText(event: FormEvent) {
    event.preventDefault()
    if (isFull) return
    addLabel(freeText)
    setFreeText('')
  }

  /** A pantry chip or the no-match button: the search has done its job. */
  function addFromSearch(addIt: () => void) {
    if (isFull) return
    addIt()
    setQuery('')
    searchRef.current?.focus()
  }

  function addLeftover(item: FridgeItemShown) {
    if (isFull) return
    add(item)
    searchRef.current?.focus()
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const fridgeItems = items.map(toFridgeItemInput)
      return entryId
        ? apiFetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fridgeItems }),
          })
        : apiFetch(`/api/meal-plans/${planId}/entries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              date,
              mealType,
              fridgeItems,
              ...(logPast ? { status: 'completed' } : {}),
            }),
          })
    },
    onSuccess: () => {
      onSaved()
      onClose()
    },
    onError: (err) => {
      // The route's `error` is English (HON-914): log it, render catalog copy.
      console.error(
        '[fridge-meal-picker] save failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      // A 409: the entry was completed meanwhile, or the open slot filled.
      if (err instanceof ApiError && err.status === 409) {
        toast.error(entryId ? t('completedConflict') : tCard('entryAlreadyExists'))
        return
      }
      toast.error(t('saveFailed'))
    },
  })
  const isSaving = saveMutation.isPending

  function save() {
    if (isSaving) return
    if (items.length === 0) {
      setShowNeedsItem(true)
      return
    }
    saveMutation.mutate()
  }

  return (
    <>
      {/* The 4px pad, pulled back by an equal margin, keeps the 3px focus ring
          of an edge control inside the box `overflow` clips (HON-1353). */}
      <div className="-m-1 flex max-h-96 flex-col gap-5 overflow-y-auto p-1">
        <section className="flex flex-col gap-2" aria-labelledby={`${searchId}-chosen`}>
          <Heading variant="caption" as="h3" id={`${searchId}-chosen`}>
            {t('chosenHeading')}
          </Heading>
          {items.length === 0 ? (
            <Body variant="muted" tone={showNeedsItem ? 'destructive' : undefined}>
              {showNeedsItem ? t('needsItem') : t('nothingChosen')}
            </Body>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((item) => {
                const text = itemText(item)
                return (
                  <li key={item.key} className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <Body variant="small">{text}</Body>
                      {/* Only a pantry item gets a "Used it all" tick when the meal is eaten. */}
                      {item.ingredientId !== null && (
                        <Body variant="small" tone="muted">
                          {t('pantryMarker')}
                        </Body>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('remove', { name: text })}
                      onClick={() =>
                        setItems((current) => current.filter((i) => i.key !== item.key))
                      }
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {recentLabels.length > 0 && (
          <section className="flex flex-col gap-2" aria-labelledby={`${searchId}-labels`}>
            <Heading variant="caption" as="h3" id={`${searchId}-labels`}>
              {t('recentLabelsHeading')}
            </Heading>
            {shownLabels.length === 0 ? (
              <Body variant="muted">{t('recentLabelsAllChosen')}</Body>
            ) : (
              <ChoiceList
                choices={shownLabels.map((label) => ({
                  key: label,
                  text: label,
                  item: {
                    ingredientId: null,
                    sourceEntryId: null,
                    label,
                    name: null,
                    sourceDate: null,
                  },
                }))}
                disabled={isFull}
                onAdd={addLeftover}
                addLabel={(name) => t('add', { name })}
              />
            )}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <Label htmlFor={searchId}>{t('pantrySearch')}</Label>
          <Input
            ref={searchRef}
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('pantrySearchPlaceholder')}
            autoComplete="off"
          />
          {atHome.length === 0 ? (
            <Body variant="muted">{t('pantryEmpty')}</Body>
          ) : shownPantry.length === 0 ? (
            // A match that is already in the meal is not "no match": offering
            // the words then would add a free-text copy of a pantry item.
            query.trim() &&
            pantryMatches.length === 0 && (
              <>
                <Body variant="muted">{t('pantryNoMatch', { query: query.trim() })}</Body>
                <div>
                  {/* A long query truncates rather than widen the dialog. */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-w-full"
                    aria-disabled={isFull || undefined}
                    onClick={() => addFromSearch(() => addLabel(query))}
                  >
                    <Plus aria-hidden="true" />
                    <span className="truncate">
                      {t('addQuery', { query: query.trim().slice(0, FRIDGE_ITEM_LABEL_MAX) })}
                    </span>
                  </Button>
                </div>
              </>
            )
          ) : (
            <ChoiceList
              choices={shownPantry.map((p) => ({
                key: p.ingredientId,
                text: p.ingredient.name,
                item: {
                  ingredientId: p.ingredientId,
                  sourceEntryId: null,
                  label: null,
                  name: p.ingredient.name,
                  sourceDate: null,
                },
              }))}
              disabled={isFull}
              onAdd={(item) => addFromSearch(() => add(item))}
              addLabel={(name) => t('add', { name })}
            />
          )}
        </section>

        <section className="flex flex-col gap-2" aria-labelledby={`${searchId}-recent`}>
          <Heading variant="caption" as="h3" id={`${searchId}-recent`}>
            {t('recentHeading')}
          </Heading>
          {recentQuery.isPending ? (
            <Body variant="muted">{t('recentLoading')}</Body>
          ) : recentQuery.isError ? (
            <Body variant="muted">{t('recentFailed')}</Body>
          ) : recentMeals.length === 0 ? (
            <Body variant="muted">{t('recentEmpty')}</Body>
          ) : (
            <ChoiceList
              choices={recentMeals.map((meal) => {
                const item: FridgeItemShown = {
                  ingredientId: null,
                  sourceEntryId: meal.entryId,
                  label: null,
                  name: meal.mealName,
                  sourceDate: meal.date,
                }
                return { key: meal.entryId, text: itemText(item), item }
              })}
              disabled={isFull}
              onAdd={addLeftover}
              addLabel={(name) => t('add', { name })}
            />
          )}
        </section>

        <form className="flex flex-col gap-2" onSubmit={addFreeText}>
          <Label htmlFor={freeTextId}>{t('freeTextLabel')}</Label>
          <div className="flex gap-2">
            <Input
              id={freeTextId}
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder={t('freeTextPlaceholder')}
              maxLength={FRIDGE_ITEM_LABEL_MAX}
              autoComplete="off"
            />
            <Button type="submit" variant="outline" aria-disabled={isFull || undefined}>
              {t('addFreeText')}
            </Button>
          </div>
        </form>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
        {/* Not `disabled`: a disabled button drops focus (HON-803). */}
        <Button onClick={save} aria-disabled={isSaving || undefined}>
          {isSaving ? t('saving') : t('save')}
        </Button>
      </DialogFooter>
    </>
  )
}

interface Choice {
  key: string
  text: string
  item: FridgeItemShown
}

/** Things to add, one button each: the pantry matches or the recent meals. */
function ChoiceList({
  choices,
  disabled,
  onAdd,
  addLabel,
}: {
  choices: Choice[]
  disabled: boolean
  onAdd: (item: FridgeItemShown) => void
  addLabel: (name: string) => string
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {choices.map((choice) => (
        <li key={choice.key}>
          <Button
            variant="outline"
            size="sm"
            aria-label={addLabel(choice.text)}
            aria-disabled={disabled || undefined}
            onClick={() => onAdd(choice.item)}
          >
            <Plus aria-hidden="true" />
            {choice.text}
          </Button>
        </li>
      ))}
    </ul>
  )
}

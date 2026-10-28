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
import type { LeftoverSource } from '@/lib/meal-plans/recent-meals'
import type { MealType } from '@/generated/prisma/enums'
import type { FridgeMealItem, PantryItemFull } from '../types'
import { toFridgeItemInput, useFridgeItemText, type FridgeItemShown } from './use-fridge-item-text'
import { LeftoverServingsControl } from './LeftoverServingsControl'

/** Pantry matches shown at once, so a full pantry does not push the rest away. */
const PANTRY_MATCHES_SHOWN = 8

/**
 * What seasons or binds a meal rather than makes one. The pantry section
 * leaves it out until the household searches for it. Herbs, sauces and pastes
 * are subcategories (parsley is a `vegetable` with `subcategory: 'herb'`), so
 * the two sets are checked against their own fields.
 */
const NOT_A_MEAL_CATEGORY = new Set(['spice', 'condiment', 'fat'])
const NOT_A_MEAL_SUBCATEGORY = new Set(['herb', 'sauce', 'paste'])

function isMealFood(p: PantryItemFull): boolean {
  return (
    !NOT_A_MEAL_CATEGORY.has(p.ingredient.category) &&
    !NOT_A_MEAL_SUBCATEGORY.has(p.ingredient.subcategory ?? '')
  )
}

/** A pantry row as a picker item. */
function pantryChoice(p: PantryItemFull): FridgeItemShown {
  return {
    ingredientId: p.ingredientId,
    sourceEntryId: null,
    label: null,
    name: p.ingredient.name,
    sourceDate: null,
    servings: null,
  }
}

/** The leftovers the picker offers for a slot. Fetched each time it opens. */
export const recentMealsQueryKey = ['recent-meals'] as const

/** What `/api/entries/recent` answers for a slot (HON-1396). */
export interface LeftoverSourcesResponse {
  meals: LeftoverSource[]
  /** The household's own servings, where a planned source's servings start. */
  defaultServings: number
}

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
 * pantry, from an earlier meal's leftovers, or in its own words. A leftover's
 * meal may still be planned, such as tonight's dinner for tomorrow's lunch, and
 * each leftover item takes servings from it (HON-1396); other items have no
 * quantities. Saving creates the entry, or replaces the items of the one given.
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
  servings: item.servings,
  sourceMealType: item.sourceMealType,
  sourceState: item.sourceState,
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
  // A chip add unmounts the chip, so focus moves here instead of to `<body>`
  // (docs/DESIGN.md → Focus management).
  const searchRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Draft[]>(() => initialItems.map(toDraft))
  const [query, setQuery] = useState('')
  const [showNeedsItem, setShowNeedsItem] = useState(false)

  const recentQuery = useQuery({
    queryKey: [...recentMealsQueryKey, date, mealType],
    queryFn: () =>
      apiFetch<LeftoverSourcesResponse>(
        `/api/entries/recent?${new URLSearchParams({ date, mealType })}`,
      ),
  })
  const defaultServings = recentQuery.data?.defaultServings ?? 1

  const chosenIngredientIds = new Set(
    items.flatMap((i) => (i.ingredientId ? [i.ingredientId] : [])),
  )
  const chosenSourceIds = new Set(items.flatMap((i) => (i.sourceEntryId ? [i.sourceEntryId] : [])))
  const isFull = items.length >= FRIDGE_ITEMS_MAX

  const needle = query.trim().toLocaleLowerCase()
  // Quantity 0 is "ran out": not at home.
  const atHome = useMemo(
    () =>
      pantryItems
        .filter((p) => p.quantity !== 0)
        .sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name)),
    [pantryItems],
  )
  // Without a query the pantry offers food, not what goes into food: a staple
  // or a seasoning is never a meal on its own. A search still finds them.
  const pantryMatches = atHome.filter((p) =>
    needle ? p.ingredient.name.toLocaleLowerCase().includes(needle) : !p.isStaple && isMealFood(p),
  )
  const shownPantry = pantryMatches
    .filter((p) => !chosenIngredientIds.has(p.ingredientId))
    .slice(0, PANTRY_MATCHES_SHOWN)
  const recentMeals = (recentQuery.data?.meals ?? []).filter(
    (m) =>
      !chosenSourceIds.has(m.entryId) &&
      (!needle || m.mealName.toLocaleLowerCase().includes(needle)),
  )
  // The words are offered as an item unless they name a pantry item exactly,
  // which the chip adds instead (a free-text copy would lose the pantry tick).
  const exactPantry = needle
    ? atHome.find((p) => p.ingredient.name.toLocaleLowerCase() === needle)
    : undefined
  const chosenLabels = new Set(items.flatMap((i) => (i.label ? [i.label.toLocaleLowerCase()] : [])))
  const shownLabels = recentLabels.filter(
    (label) =>
      !chosenLabels.has(label.toLocaleLowerCase()) &&
      (!needle || label.toLocaleLowerCase().includes(needle)),
  )

  function add(item: FridgeItemShown) {
    if (isFull) return
    setShowNeedsItem(false)
    setItems((current) => [...current, toDraft(item)])
  }

  function setServings(key: string, servings: number) {
    setItems((current) => current.map((i) => (i.key === key ? { ...i, servings } : i)))
  }

  /** The household's own words, as the `Add "…"` button and Enter add them. */
  function addLabel(text: string) {
    const label = text.trim().slice(0, FRIDGE_ITEM_LABEL_MAX)
    if (!label) return
    add({
      ingredientId: null,
      sourceEntryId: null,
      label,
      name: null,
      sourceDate: null,
      servings: null,
    })
  }

  /** Any add: the field has done its job, so it empties and keeps focus. */
  function addFromField(addIt: () => void) {
    if (isFull) return
    addIt()
    setQuery('')
    searchRef.current?.focus()
  }

  // Enter adds what was typed: the pantry item it names, or the words.
  function submitField(event: FormEvent) {
    event.preventDefault()
    if (!needle) return
    if (exactPantry && !chosenIngredientIds.has(exactPantry.ingredientId)) {
      addFromField(() => add(pantryChoice(exactPantry)))
      return
    }
    if (exactPantry) return
    addFromField(() => addLabel(query))
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
      // A leftover's meal changed since the list loaded (HON-1396).
      if (err instanceof ApiError && err.code === 'leftover_source') {
        toast.error(t('leftoverRefused'))
        return
      }
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
          <Heading variant="section" as="h3" id={`${searchId}-chosen`}>
            {t('chosenHeading')}
          </Heading>
          {items.length === 0 ? (
            <Body variant="muted" tone={showNeedsItem ? 'destructive' : undefined}>
              {showNeedsItem ? t('needsItem') : t('nothingChosen')}
            </Body>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((item) => {
                // A leftover's servings show in its control, not in its words.
                const text = itemText({ ...item, servings: null })
                return (
                  <li key={item.key} className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <Body variant="small">{text}</Body>
                      {/* Only a pantry item gets a "Used it all" tick when the meal is eaten. */}
                      {item.ingredientId !== null && (
                        <Body variant="small" tone="muted">
                          {t('pantryMarker')}
                        </Body>
                      )}
                      {item.sourceState === 'planned' && (
                        <Body variant="small" tone="muted">
                          {t('sourcePlanned')}
                        </Body>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {item.sourceEntryId !== null && (
                        <LeftoverServingsControl
                          value={item.servings}
                          onChange={(servings) => setServings(item.key, servings)}
                          defaultServings={defaultServings}
                          label={t('servingsGroup', { name: text })}
                        />
                      )}
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
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* One field for everything: it filters the leftovers and the pantry
            below it, and Enter or `Add "…"` takes the words as they are. */}
        <form className="flex flex-col gap-2" onSubmit={submitField}>
          <Label htmlFor={searchId}>{t('addField')}</Label>
          <Input
            ref={searchRef}
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('addFieldPlaceholder')}
            autoComplete="off"
          />
          {needle && !exactPantry && (
            <div>
              {/* A long query truncates rather than widen the dialog. */}
              <Button
                variant="outline"
                size="sm"
                className="max-w-full"
                aria-disabled={isFull || undefined}
                onClick={() => addFromField(() => addLabel(query))}
              >
                <Plus aria-hidden="true" />
                <span className="truncate">
                  {t('addQuery', { query: query.trim().slice(0, FRIDGE_ITEM_LABEL_MAX) })}
                </span>
              </Button>
            </div>
          )}
        </form>

        {/* The household's own words of the last 30 days (HON-1383), so
            "Wolt" stays one label. */}
        {shownLabels.length > 0 && (
          <section className="flex flex-col gap-2" aria-labelledby={`${searchId}-labels`}>
            <Heading variant="section" as="h3" id={`${searchId}-labels`}>
              {t('recentLabelsHeading')}
            </Heading>
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
                  servings: null,
                },
              }))}
              disabled={isFull}
              onAdd={(item) => addFromField(() => add(item))}
              addLabel={(name) => t('add', { name })}
            />
          </section>
        )}

        {/* Leftovers first: a meal already cooked, or tonight's still to cook,
            is the likeliest fridge meal. A section with nothing to offer is
            left out. */}
        {recentQuery.isError ? (
          <Body variant="muted">{t('recentFailed')}</Body>
        ) : (
          recentMeals.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby={`${searchId}-recent`}>
              <Heading variant="section" as="h3" id={`${searchId}-recent`}>
                {t('recentHeading')}
              </Heading>
              <ChoiceList
                choices={recentMeals.map((meal) => {
                  // A planned source needs servings, so it starts at the
                  // household's own (HON-1396); a cooked one may stay unset.
                  const item: FridgeItemShown = {
                    ingredientId: null,
                    sourceEntryId: meal.entryId,
                    label: null,
                    name: meal.mealName,
                    sourceDate: meal.date,
                    servings: meal.sourceState === 'planned' ? defaultServings : null,
                    sourceMealType: meal.mealType,
                    sourceState: meal.sourceState,
                  }
                  const text = itemText({ ...item, servings: null })
                  return {
                    key: meal.entryId,
                    text: meal.sourceState === 'planned' ? `${text} · ${t('sourcePlanned')}` : text,
                    item,
                  }
                })}
                disabled={isFull}
                onAdd={(item) => addFromField(() => add(item))}
                addLabel={(name) => t('add', { name })}
              />
            </section>
          )
        )}

        {shownPantry.length > 0 && (
          <section className="flex flex-col gap-2" aria-labelledby={`${searchId}-pantry`}>
            <Heading variant="section" as="h3" id={`${searchId}-pantry`}>
              {t('pantryHeading')}
            </Heading>
            <ChoiceList
              choices={shownPantry.map((p) => ({
                key: p.ingredientId,
                text: p.ingredient.name,
                item: pantryChoice(p),
              }))}
              disabled={isFull}
              onAdd={(item) => addFromField(() => add(item))}
              addLabel={(name) => t('add', { name })}
            />
          </section>
        )}
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

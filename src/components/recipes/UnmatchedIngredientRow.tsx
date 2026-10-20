'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { AlertTriangle, Plus, Search, X, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { useEnumLabel, useVaguePhrase } from '@/lib/i18n/enum-label'
import { useIngredientSearch, withoutMatchedAs } from '@/hooks/use-ingredient-search'
import { convertQuantity } from '@/lib/ai/recipe-quantities'
import type { UnmatchedIngredientData, IngredientResult } from './IngredientRow'
import { AddIngredientForm } from './AddIngredientForm'
import type { IngredientCategory } from '@/generated/prisma/enums'

function CategoryHint({ category }: { category: IngredientCategory }) {
  const label = useEnumLabel('IngredientCategory', category)
  return <Body variant="muted">({label})</Body>
}

interface UnmatchedIngredientRowProps {
  data: UnmatchedIngredientData
  disabled: boolean
  onRemove: () => void
  onResolve?: (ingredient: IngredientResult, totalQuantity: number) => void
}

export function UnmatchedIngredientRow({
  data,
  disabled,
  onRemove,
  onResolve,
}: UnmatchedIngredientRowProps) {
  const t = useTranslations('recipes.ingredientRow')
  const vaguePhrase = useVaguePhrase()
  const [searchQuery, setSearchQuery] = useState('')
  // The dropdown opens as soon as results exist; this only tracks whether the
  // user dismissed it (Escape, click outside, or after picking a match).
  const [isDropdownDismissed, setIsDropdownDismissed] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  // "Add as new ingredient" (HON-1263) opens a form in place of the search.
  const [isAdding, setIsAdding] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const refocusAddButton = useRef(false)

  // Cancel returns focus to the button that opened the form.
  useEffect(() => {
    if (isAdding || !refocusAddButton.current) return
    refocusAddButton.current = false
    addButtonRef.current?.focus()
  }, [isAdding])

  const { data: searchResults = [], isLoading: isSearching } = useIngredientSearch(searchQuery)
  const showDropdown = !isDropdownDismissed && searchResults.length > 0
  // Guard against a result set that shrank under a stale highlight.
  const activeIndex = highlightedIndex < searchResults.length ? highlightedIndex : -1

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setIsDropdownDismissed(true)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    setIsDropdownDismissed(false)
    setHighlightedIndex(-1)
  }

  const handleSelectIngredient = useCallback(
    (ingredient: IngredientResult) => {
      // Calculate a reasonable default quantity
      const defaultQuantity = ingredient.defaultUnit === 'piece' ? 1 : 100

      if (onResolve) {
        onResolve(withoutMatchedAs(ingredient), defaultQuantity)
      }

      setSearchQuery('')
      setIsDropdownDismissed(true)
      setHighlightedIndex(-1)
    },
    [onResolve],
  )

  const handleCancelAdd = () => {
    refocusAddButton.current = true
    setIsAdding(false)
  }

  // The user named exactly this ingredient, so the parsed amount is right:
  // "1 tsp" becomes 5 g, as the matcher converts it for a catalogue hit. A
  // vague or empty quantity takes the search's default.
  const handleCreated = (ingredient: IngredientResult) => {
    const quantity =
      !data.isVague && data.extractedQuantity > 0
        ? convertQuantity(data.extractedQuantity, data.extractedUnit || 'g', {
            defaultUnit: ingredient.defaultUnit,
            gramsPerPiece: ingredient.gramsPerPiece ?? null,
            category: ingredient.category,
          })
        : ingredient.defaultUnit === 'piece'
          ? 1
          : 100
    onResolve?.(ingredient, quantity)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => Math.min(prev + 1, searchResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selectedResult = searchResults[activeIndex]
      if (activeIndex >= 0 && selectedResult) {
        handleSelectIngredient(selectedResult)
      } else if (searchResults.length === 1 && searchResults[0]) {
        handleSelectIngredient(searchResults[0])
      }
    } else if (e.key === 'Escape') {
      setIsDropdownDismissed(true)
      setHighlightedIndex(-1)
    }
  }

  return (
    <div className="border-warning/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-warning mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <Body tone="warning">{data.extractedName}</Body>
            <Body variant="muted">
              {data.isVague && data.originalPhrase ? (
                <span className="italic">{vaguePhrase(data.originalPhrase)}</span>
              ) : (
                t('originalLabel', { text: data.originalText })
              )}
            </Body>
          </div>
        </div>
        <Button type="button" variant="quiet" size="sm" onClick={onRemove} disabled={disabled}>
          <X className="mr-1 h-4 w-4" />
          {t('drop')}
        </Button>
      </div>

      {isAdding ? (
        <div className="ml-7">
          <AddIngredientForm
            extractedName={data.extractedName}
            onCreated={handleCreated}
            onCancel={handleCancelAdd}
          />
        </div>
      ) : (
        <>
          {/* Search dropdown for finding a match */}
          <div className="relative ml-7">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => setIsDropdownDismissed(false)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchAria', { name: data.extractedName })}
                className="pr-9 pl-9"
                disabled={disabled}
              />
              {isSearching && (
                <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
              )}
            </div>

            {showDropdown && (
              <div
                ref={dropdownRef}
                data-slot="autocomplete-content"
                className="bg-popover absolute top-full z-10 mt-1 w-full rounded-md border shadow-md"
              >
                {searchResults.map((ingredient, index) => (
                  <button
                    key={ingredient.id}
                    type="button"
                    onClick={() => handleSelectIngredient(ingredient)}
                    disabled={disabled}
                    className={cn(
                      'flex w-full items-center justify-between px-3 py-2 text-left transition-colors',
                      'hover:bg-muted focus:bg-muted focus:outline-none',
                      index > 0 && 'border-t',
                      activeIndex === index && 'bg-muted',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Body>{ingredient.name}</Body>
                      {ingredient.matchedAs && <Body tone="muted">({ingredient.matchedAs})</Body>}
                      <CategoryHint category={ingredient.category} />
                    </div>
                  </button>
                ))}
              </div>
            )}

            {searchQuery.trim() && !isSearching && searchResults.length === 0 && (
              <div
                data-slot="autocomplete-content"
                className="bg-popover absolute top-full z-10 mt-1 w-full rounded-md border p-3 shadow-md"
              >
                <Body variant="muted" className="text-center">
                  {t('noResults')}
                </Body>
              </div>
            )}
          </div>

          {onResolve && (
            // `contain-inline-size`: the nowrap label must not set the row's
            // min-content width, or it widens the Imagine dialog's column.
            <div className="ml-7 contain-inline-size">
              <Button
                ref={addButtonRef}
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => setIsAdding(true)}
                disabled={disabled}
                // A long name truncates rather than running out of the row
                // at 390px (HON-834); the row's heading shows it in full.
                className="max-w-full"
              >
                <Plus className="mr-1 h-4 w-4" />
                <span className="truncate">{t('addNew', { name: data.extractedName })}</span>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

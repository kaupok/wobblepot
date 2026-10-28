'use client'

import { useState, useEffect, useRef, useId } from 'react'
import { Search, Plus, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { useIngredientSearch, withoutMatchedAs } from '@/hooks/use-ingredient-search'
import { type IngredientResult } from './meal-form-types'
import type { IngredientCategory } from '@/generated/prisma/enums'

function CategoryHint({ category }: { category: IngredientCategory }) {
  const label = useEnumLabel('IngredientCategory', category)
  return <Body variant="muted">({label})</Body>
}

interface IngredientSearchProps {
  disabled: boolean
  existingIngredientIds: string[]
  onAddIngredient: (ingredient: IngredientResult) => void
  /** The search field, so a caller can send focus back to it for the next ingredient. */
  inputRef?: React.RefObject<HTMLInputElement | null>
}

export function IngredientSearch({
  disabled,
  existingIngredientIds,
  onAddIngredient,
  inputRef,
}: IngredientSearchProps) {
  const t = useTranslations('recipes.form.ingredientSearch')
  const [searchQuery, setSearchQuery] = useState('')
  // The dropdown opens as soon as results exist; this only tracks whether the
  // user dismissed it (Escape, click outside, or after picking a result).
  const [isDropdownDismissed, setIsDropdownDismissed] = useState(false)
  // -1 until the user moves with the arrow keys; the first result is then
  // highlighted, so Enter adds it (HON-1362).
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const ownInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = inputRef ?? ownInputRef
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const { data: searchResults = [], isLoading: isSearching } = useIngredientSearch(searchQuery)
  const showDropdown = !isDropdownDismissed && searchResults.length > 0
  const firstAddableIndex = searchResults.findIndex((r) => !existingIngredientIds.includes(r.id))
  // Fall back to the first addable result when nothing is highlighted, or when
  // the result set shrank under a stale highlight.
  const activeIndex =
    highlightedIndex >= 0 && highlightedIndex < searchResults.length
      ? highlightedIndex
      : firstAddableIndex

  const getOptionId = (index: number) => `${listboxId}-option-${index}`

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
  }, [searchInputRef])

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    setIsDropdownDismissed(false)
    setHighlightedIndex(-1)
  }

  const handleAdd = (ingredient: IngredientResult) => {
    // Keep focus in the field for the next search rather than letting it fall
    // to <body> as a clicked option unmounts. Focus first: the field's
    // onFocus re-opens the dropdown, and the dismissal below must win.
    searchInputRef.current?.focus()
    onAddIngredient(withoutMatchedAs(ingredient))
    setSearchQuery('')
    setIsDropdownDismissed(true)
    setHighlightedIndex(-1)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(Math.min(activeIndex + 1, searchResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(Math.max(activeIndex - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selectedResult = searchResults[activeIndex]
      if (selectedResult && !existingIngredientIds.includes(selectedResult.id)) {
        handleAdd(selectedResult)
      }
    } else if (e.key === 'Escape') {
      setIsDropdownDismissed(true)
      setHighlightedIndex(-1)
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => setIsDropdownDismissed(false)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('placeholder')}
          aria-label={t('aria')}
          // Kept clear of the phone tab bar when the form sends focus back here.
          className="scroll-mb-above-tab-bar pr-9 pl-9 md:scroll-mb-0"
          disabled={disabled}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listboxId : undefined}
          aria-activedescendant={
            showDropdown && activeIndex >= 0 ? getOptionId(activeIndex) : undefined
          }
          aria-autocomplete="list"
        />
        {isSearching && (
          <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
        )}
      </div>

      {showDropdown && (
        <div
          ref={dropdownRef}
          id={listboxId}
          role="listbox"
          className="bg-popover absolute top-full z-10 mt-1 w-full rounded-md border shadow-md"
        >
          {searchResults.map((ingredient, index) => {
            const isAdded = existingIngredientIds.includes(ingredient.id)
            return (
              <button
                key={ingredient.id}
                id={getOptionId(index)}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                // Keep focus in the field: the option unmounts once it is picked.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleAdd(ingredient)}
                disabled={disabled || isAdded}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left transition-colors',
                  'hover:bg-muted focus:bg-muted focus:outline-none',
                  index > 0 && 'border-t',
                  activeIndex === index && 'bg-muted',
                  isAdded && 'opacity-50',
                )}
              >
                <div className="flex items-center gap-2">
                  <Body tone={isAdded ? 'muted' : 'default'}>{ingredient.name}</Body>
                  {ingredient.matchedAs && <Body tone="muted">({ingredient.matchedAs})</Body>}
                  <CategoryHint category={ingredient.category} />
                </div>
                {isAdded ? (
                  <Body variant="muted">{t('added')}</Body>
                ) : (
                  <Plus className="text-muted-foreground h-4 w-4" />
                )}
              </button>
            )
          })}
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
  )
}

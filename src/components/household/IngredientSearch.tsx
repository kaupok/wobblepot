'use client'

import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { Search, Plus, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { useIngredientSearch } from '@/hooks/use-ingredient-search'
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
}

export function IngredientSearch({
  disabled,
  existingIngredientIds,
  onAddIngredient,
}: IngredientSearchProps) {
  const t = useTranslations('recipes.form.ingredientSearch')
  const [searchQuery, setSearchQuery] = useState('')
  // The dropdown opens as soon as results exist; this only tracks whether the
  // user dismissed it (Escape, click outside, or after picking a result).
  const [isDropdownDismissed, setIsDropdownDismissed] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const { data: searchResults = [], isLoading: isSearching } = useIngredientSearch(searchQuery)
  const showDropdown = !isDropdownDismissed && searchResults.length > 0
  // Guard against a result set that shrank under a stale highlight.
  const activeIndex = highlightedIndex < searchResults.length ? highlightedIndex : -1

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
  }, [])

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    setIsDropdownDismissed(false)
    setHighlightedIndex(-1)
  }

  const handleAdd = useCallback(
    (ingredient: IngredientResult) => {
      onAddIngredient(ingredient)
      setSearchQuery('')
      setIsDropdownDismissed(true)
      setHighlightedIndex(-1)
    },
    [onAddIngredient],
  )

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
        handleAdd(selectedResult)
      } else if (searchResults.length === 1 && searchResults[0]) {
        handleAdd(searchResults[0])
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
          className="pr-9 pl-9"
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
                  <Body className={isAdded ? 'text-muted-foreground' : undefined}>
                    {ingredient.name}
                  </Body>
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
        <div className="bg-popover absolute top-full z-10 mt-1 w-full rounded-md border p-3 shadow-md">
          <Body variant="muted" className="text-center">
            {t('noResults')}
          </Body>
        </div>
      )}
    </div>
  )
}

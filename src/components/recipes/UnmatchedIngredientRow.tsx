'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { AlertTriangle, Search, X, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { useIngredientSearch } from '@/hooks/use-ingredient-search'
import type { UnmatchedIngredientData, IngredientResult } from './IngredientRow'
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
  const [searchQuery, setSearchQuery] = useState('')
  // The dropdown opens as soon as results exist; this only tracks whether the
  // user dismissed it (Escape, click outside, or after picking a match).
  const [isDropdownDismissed, setIsDropdownDismissed] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

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
        onResolve(ingredient, defaultQuantity)
      }

      setSearchQuery('')
      setIsDropdownDismissed(true)
      setHighlightedIndex(-1)
    },
    [onResolve],
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
            <Body className="text-warning">{data.extractedName}</Body>
            <Body variant="muted">
              {data.isVague && data.originalPhrase ? (
                <span className="italic">{data.originalPhrase}</span>
              ) : (
                t('originalLabel', { text: data.originalText })
              )}
            </Body>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={disabled}
          className="text-warning hover:text-warning"
        >
          <X className="mr-1 h-4 w-4" />
          {t('drop')}
        </Button>
      </div>

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
                  <CategoryHint category={ingredient.category} />
                </div>
              </button>
            ))}
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
    </div>
  )
}

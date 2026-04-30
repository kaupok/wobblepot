'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { AlertTriangle, Search, X, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { useEnumLabel } from '@/lib/i18n/enum-label'
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
  const [searchResults, setSearchResults] = useState<IngredientResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Search for ingredients
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!searchQuery.trim()) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true)
      try {
        const response = await fetch(
          `/api/ingredients?search=${encodeURIComponent(searchQuery.trim())}`,
        )
        if (response.ok) {
          const result = await response.json()
          setSearchResults(result.ingredients)
          setShowDropdown(result.ingredients.length > 0)
          setHighlightedIndex(-1)
        }
      } catch {
        // Ignore errors
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [searchQuery])

  const handleSelectIngredient = useCallback(
    (ingredient: IngredientResult) => {
      // Calculate a reasonable default quantity
      const defaultQuantity = ingredient.defaultUnit === 'piece' ? 1 : 100

      if (onResolve) {
        onResolve(ingredient, defaultQuantity)
      }

      setSearchQuery('')
      setShowDropdown(false)
      setSearchResults([])
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
      const selectedResult = searchResults[highlightedIndex]
      if (highlightedIndex >= 0 && selectedResult) {
        handleSelectIngredient(selectedResult)
      } else if (searchResults.length === 1 && searchResults[0]) {
        handleSelectIngredient(searchResults[0])
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
      setHighlightedIndex(-1)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="flex flex-col gap-0.5">
            <Body className="text-amber-700 dark:text-amber-400">{data.extractedName}</Body>
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
          className="text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/50"
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
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => {
              if (searchResults.length > 0) {
                setShowDropdown(true)
              }
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder={t('searchPlaceholder')}
            className="pr-9 pl-9"
            disabled={disabled}
          />
          {isSearching && (
            <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
          )}
        </div>

        {showDropdown && searchResults.length > 0 && (
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
                  highlightedIndex === index && 'bg-muted',
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

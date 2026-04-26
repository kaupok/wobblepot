'use client'

import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { Search, Plus, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { useEnumLabel } from '@/lib/i18n/enum-label'
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
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<IngredientResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

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
          const data = await response.json()
          setSearchResults(data.ingredients)
          setShowDropdown(data.ingredients.length > 0)
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

  const handleAdd = useCallback(
    (ingredient: IngredientResult) => {
      onAddIngredient(ingredient)
      setSearchQuery('')
      setShowDropdown(false)
      setSearchResults([])
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
      const selectedResult = searchResults[highlightedIndex]
      if (highlightedIndex >= 0 && selectedResult) {
        handleAdd(selectedResult)
      } else if (searchResults.length === 1 && searchResults[0]) {
        handleAdd(searchResults[0])
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
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
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => {
            if (searchResults.length > 0) {
              setShowDropdown(true)
            }
          }}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search to add more ingredients..."
          className="pr-9 pl-9"
          disabled={disabled}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={showDropdown && searchResults.length > 0 ? listboxId : undefined}
          aria-activedescendant={
            showDropdown && highlightedIndex >= 0 ? getOptionId(highlightedIndex) : undefined
          }
          aria-autocomplete="list"
        />
        {isSearching && (
          <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
        )}
      </div>

      {showDropdown && searchResults.length > 0 && (
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
                aria-selected={highlightedIndex === index}
                onClick={() => handleAdd(ingredient)}
                disabled={disabled || isAdded}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left transition-colors',
                  'hover:bg-muted focus:bg-muted focus:outline-none',
                  index > 0 && 'border-t',
                  highlightedIndex === index && 'bg-muted',
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
                  <Body variant="muted">Added</Body>
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
            No ingredients found
          </Body>
        </div>
      )}
    </div>
  )
}

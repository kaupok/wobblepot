'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Plus, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { track } from '@/lib/analytics'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { useIngredientSearch, type IngredientResult } from '@/hooks/use-ingredient-search'
import type { PantryItemData } from './PantryItem'
import type { IngredientCategory } from '@/generated/prisma/enums'

interface InlineAddItemProps {
  onItemAdded: (item: PantryItemData) => void
  pantryIngredientIds?: Set<string>
}

function CategoryHint({ category }: { category: IngredientCategory }) {
  const label = useEnumLabel('IngredientCategory', category)
  return <Body variant="muted">({label})</Body>
}

export function InlineAddItem({
  onItemAdded,
  pantryIngredientIds = new Set(),
}: InlineAddItemProps) {
  const tPantry = useTranslations('pantry')
  const [query, setQuery] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  // The dropdown opens as soon as results exist; this only tracks whether the
  // user dismissed it (Escape, click outside, or after adding an item).
  const [isDropdownDismissed, setIsDropdownDismissed] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data: results = [], isLoading } = useIngredientSearch(query)
  const showDropdown = !isDropdownDismissed && results.length > 0
  // Guard against a result set that shrank under a stale highlight.
  const activeIndex = highlightedIndex < results.length ? highlightedIndex : -1

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsDropdownDismissed(true)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setIsDropdownDismissed(false)
    setHighlightedIndex(-1)
  }

  const addItem = async (ingredient: IngredientResult) => {
    setIsAdding(true)
    try {
      const response = await fetch('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientId: ingredient.id,
          isStaple: false,
        }),
      })

      if (!response.ok) {
        if (response.status === 409) {
          toast.error(tPantry('alreadyInPantry', { name: ingredient.name }))
          return
        }
        throw new Error(tPantry('errors.addFailed'))
      }

      const data = await response.json()
      void track('pantry:item_added', { source: 'pantry_inline' })
      onItemAdded(data)
      setQuery('')
      setIsDropdownDismissed(true)
      setHighlightedIndex(-1)
      toast.success(tPantry('success.added', { name: ingredient.name }))
    } catch {
      toast.error(tPantry('errors.addFailed'))
    } finally {
      setIsAdding(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selectedResult = results[activeIndex]
      if (activeIndex >= 0 && selectedResult) {
        addItem(selectedResult)
      } else if (results.length === 1 && results[0]) {
        addItem(results[0])
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
          ref={inputRef}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => setIsDropdownDismissed(false)}
          onKeyDown={handleKeyDown}
          placeholder={tPantry('addPlaceholder')}
          className="pr-9 pl-9"
          disabled={isAdding}
        />
        {isLoading && (
          <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
        )}
      </div>

      {showDropdown && (
        <div
          ref={dropdownRef}
          className="bg-popover absolute top-full z-10 mt-1 w-full rounded-md border shadow-md"
        >
          {results.map((ingredient, index) => {
            const isInPantry = pantryIngredientIds.has(ingredient.id)
            return (
              <button
                key={ingredient.id}
                type="button"
                onClick={() => addItem(ingredient)}
                disabled={isAdding}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left transition-colors',
                  'hover:bg-muted focus:bg-muted focus:outline-none',
                  index > 0 && 'border-t',
                  activeIndex === index && 'bg-muted',
                )}
              >
                <div className="flex items-center gap-2">
                  <Body className={isInPantry ? 'text-muted-foreground' : undefined}>
                    {ingredient.name}
                  </Body>
                  <CategoryHint category={ingredient.category} />
                  {isInPantry && (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      <Check className="h-3 w-3" />
                      {tPantry('inPantry')}
                    </span>
                  )}
                </div>
                <Plus className="text-muted-foreground h-4 w-4" />
              </button>
            )
          })}
        </div>
      )}

      {query.trim() && !isLoading && results.length === 0 && (
        <div className="bg-popover absolute top-full z-10 mt-1 w-full rounded-md border p-3 shadow-md">
          <Body variant="muted" className="text-center">
            {tPantry('noResults')}
          </Body>
        </div>
      )}
    </div>
  )
}

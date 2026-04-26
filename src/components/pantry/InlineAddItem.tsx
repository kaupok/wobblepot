'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Plus, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { track } from '@/lib/analytics'
import type { PantryItemData } from './PantryItem'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'

interface IngredientResult {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
}

interface InlineAddItemProps {
  onItemAdded: (item: PantryItemData) => void
  pantryIngredientIds?: Set<string>
}

function formatCategory(category: IngredientCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

export function InlineAddItem({
  onItemAdded,
  pantryIngredientIds = new Set(),
}: InlineAddItemProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<IngredientResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
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

    if (!query.trim()) {
      setResults([])
      setShowDropdown(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true)
      try {
        const response = await fetch(`/api/ingredients?search=${encodeURIComponent(query.trim())}`)
        if (response.ok) {
          const data = await response.json()
          setResults(data.ingredients)
          setShowDropdown(data.ingredients.length > 0)
          setHighlightedIndex(-1)
        }
      } catch {
        // Ignore errors - just don't show results
      } finally {
        setIsLoading(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query])

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
          toast.error(`${ingredient.name} is already in your pantry`)
          return
        }
        throw new Error('Failed to add item')
      }

      const data = await response.json()
      void track('pantry:item_added', { source: 'pantry_inline' })
      onItemAdded(data)
      setQuery('')
      setResults([])
      setShowDropdown(false)
      toast.success(`${ingredient.name} added to pantry`)
    } catch {
      toast.error('Failed to add item to pantry')
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
      const selectedResult = results[highlightedIndex]
      if (highlightedIndex >= 0 && selectedResult) {
        addItem(selectedResult)
      } else if (results.length === 1 && results[0]) {
        addItem(results[0])
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
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0) {
              setShowDropdown(true)
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Add ingredient to pantry..."
          className="pr-9 pl-9"
          disabled={isAdding}
        />
        {isLoading && (
          <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
        )}
      </div>

      {showDropdown && results.length > 0 && (
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
                  highlightedIndex === index && 'bg-muted',
                )}
              >
                <div className="flex items-center gap-2">
                  <Body className={isInPantry ? 'text-muted-foreground' : undefined}>
                    {ingredient.name}
                  </Body>
                  <Body variant="muted">({formatCategory(ingredient.category)})</Body>
                  {isInPantry && (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      <Check className="h-3 w-3" />
                      In pantry
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
            No ingredients found
          </Body>
        </div>
      )}
    </div>
  )
}

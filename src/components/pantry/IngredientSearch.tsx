'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'

export interface IngredientResult {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
}

interface IngredientSearchProps {
  selectedIngredient: IngredientResult | null
  onSelect: (ingredient: IngredientResult | null) => void
  resetKey?: number
}

function formatCategory(category: IngredientCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

export function IngredientSearch({
  selectedIngredient,
  onSelect,
  resetKey,
}: IngredientSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<IngredientResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset query when resetKey changes (dialog reopens)
  useEffect(() => {
    setQuery('')
    setResults([])
  }, [resetKey])

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!query.trim()) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true)
      try {
        const response = await fetch(`/api/ingredients?search=${encodeURIComponent(query.trim())}`)
        if (response.ok) {
          const data = await response.json()
          setResults(data.ingredients)
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

  const handleSelect = (ingredient: IngredientResult) => {
    if (selectedIngredient?.id === ingredient.id) {
      onSelect(null)
    } else {
      onSelect(ingredient)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="ingredient-search">Ingredient</Label>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            id="ingredient-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ingredients..."
            className="pl-9"
          />
        </div>
      </div>

      {isLoading && (
        <Body variant="muted" className="text-center">
          Searching...
        </Body>
      )}

      {!isLoading && query.trim() && results.length === 0 && (
        <Body variant="muted" className="text-center">
          No ingredients found
        </Body>
      )}

      {results.length > 0 && (
        <div className="flex flex-col gap-1">
          <Body variant="small" className="text-muted-foreground">
            Results
          </Body>
          <div className="flex flex-col rounded-lg border">
            {results.map((ingredient, index) => (
              <button
                key={ingredient.id}
                type="button"
                onClick={() => handleSelect(ingredient)}
                className={cn(
                  'hover:bg-muted flex items-center justify-between px-3 py-2 text-left transition-colors',
                  index > 0 && 'border-t',
                  selectedIngredient?.id === ingredient.id && 'bg-muted',
                )}
              >
                <div className="flex items-center gap-2">
                  <Body>{ingredient.name}</Body>
                  <Body variant="muted">({formatCategory(ingredient.category)})</Body>
                </div>
                {selectedIngredient?.id === ingredient.id && (
                  <Check className="text-primary h-4 w-4" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedIngredient && !results.find((r) => r.id === selectedIngredient.id) && (
        <div className="bg-muted flex items-center gap-2 rounded-lg border p-3">
          <Check className="text-primary h-4 w-4" />
          <Body>
            {selectedIngredient.name}{' '}
            <span className="text-muted-foreground">
              ({formatCategory(selectedIngredient.category)})
            </span>
          </Body>
        </div>
      )}
    </div>
  )
}

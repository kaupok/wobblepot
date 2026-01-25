'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Check, AlertTriangle, HelpCircle, Search, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Body } from '@/components/ui/typography'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'

interface IngredientResult {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
}

interface IngredientAlternative {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
  similarity: number
}

// High-confidence matched ingredient
interface MatchedIngredientData {
  type: 'matched'
  ingredient: IngredientResult
  totalQuantity: number
  isVague?: boolean
  originalPhrase?: string | null
}

// Low-confidence matched ingredient with alternatives
interface LowConfidenceIngredientData {
  type: 'low-confidence'
  extractedName: string
  ingredient: IngredientResult
  alternatives: IngredientAlternative[]
  totalQuantity: number
  isVague?: boolean
  originalPhrase?: string | null
}

// Unmatched ingredient that needs resolution
interface UnmatchedIngredientData {
  type: 'unmatched'
  extractedName: string
  originalText: string
  extractedQuantity: number
  extractedUnit: string
  isVague?: boolean
  originalPhrase?: string | null
}

export type IngredientRowData =
  | MatchedIngredientData
  | LowConfidenceIngredientData
  | UnmatchedIngredientData

interface IngredientRowProps {
  data: IngredientRowData
  servings: number
  disabled?: boolean
  onUpdate: (data: IngredientRowData) => void
  onRemove: () => void
  onResolve?: (ingredient: IngredientResult, totalQuantity: number) => void
}

function formatUnit(unit: Unit): string {
  return unit === 'g' ? 'g' : ''
}

function formatCategory(category: IngredientCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

export function IngredientRow({
  data,
  servings,
  disabled = false,
  onUpdate,
  onRemove,
  onResolve,
}: IngredientRowProps) {
  // Search state for unmatched ingredients
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
      if (data.type !== 'unmatched') return

      // Calculate a reasonable default quantity
      const defaultQuantity = ingredient.defaultUnit === 'piece' ? 1 : 100

      if (onResolve) {
        onResolve(ingredient, defaultQuantity)
      }

      setSearchQuery('')
      setShowDropdown(false)
      setSearchResults([])
    },
    [data, onResolve],
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

  const handleQuantityChange = (newQuantity: number) => {
    if (data.type === 'matched') {
      onUpdate({
        ...data,
        totalQuantity: newQuantity,
        isVague: false,
        originalPhrase: null,
      })
    } else if (data.type === 'low-confidence') {
      onUpdate({
        ...data,
        totalQuantity: newQuantity,
        isVague: false,
        originalPhrase: null,
      })
    }
  }

  const handleAlternativeSelect = (selectedId: string) => {
    if (data.type !== 'low-confidence') return

    // Find the selected alternative
    const selectedAlt = data.alternatives.find((alt) => alt.id === selectedId)
    if (!selectedAlt) return

    // Convert to matched ingredient
    onUpdate({
      type: 'matched',
      ingredient: {
        id: selectedAlt.id,
        name: selectedAlt.name,
        category: selectedAlt.category,
        defaultUnit: selectedAlt.defaultUnit,
      },
      totalQuantity: data.totalQuantity,
      isVague: data.isVague,
      originalPhrase: data.originalPhrase,
    })
  }

  const handleConfirmBestMatch = () => {
    if (data.type !== 'low-confidence') return

    // Convert to high-confidence matched
    onUpdate({
      type: 'matched',
      ingredient: data.ingredient,
      totalQuantity: data.totalQuantity,
      isVague: data.isVague,
      originalPhrase: data.originalPhrase,
    })
  }

  // Render based on ingredient type
  if (data.type === 'unmatched') {
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
                  <>Original: {data.originalText}</>
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
            Drop
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
              placeholder="Search ingredients..."
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
                    <Body variant="muted">({formatCategory(ingredient.category)})</Body>
                  </div>
                </button>
              ))}
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
      </div>
    )
  }

  if (data.type === 'low-confidence') {
    const perServing = Math.round((data.totalQuantity / servings) * 10) / 10
    const isInvalidQuantity = !data.isVague && data.totalQuantity <= 0

    return (
      <div className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
        <div className="flex items-start gap-3">
          <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <Body className="text-blue-700 dark:text-blue-400">{data.extractedName}</Body>
                <Body variant="muted">
                  {data.isVague && data.originalPhrase ? (
                    <span className="italic">{data.originalPhrase}</span>
                  ) : isInvalidQuantity ? (
                    <span className="text-destructive">Quantity must be greater than 0</span>
                  ) : (
                    <>
                      {perServing}
                      {formatUnit(data.ingredient.defaultUnit)} per serving
                    </>
                  )}
                </Body>
              </div>
              <div className="flex items-center gap-2">
                {!data.isVague && (
                  <>
                    <Input
                      type="number"
                      value={data.totalQuantity}
                      onChange={(e) => handleQuantityChange(parseFloat(e.target.value) || 0)}
                      min={0.1}
                      step="any"
                      className={cn('w-24', isInvalidQuantity && 'border-destructive')}
                      disabled={disabled}
                    />
                    <Body variant="muted">{formatUnit(data.ingredient.defaultUnit)}</Body>
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onRemove}
                  disabled={disabled}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Disambiguation dropdown */}
            <div className="flex items-center gap-2">
              <Body variant="small" className="text-blue-700 dark:text-blue-400">
                Verify match:
              </Body>
              <Select
                value={data.ingredient.id}
                onValueChange={handleAlternativeSelect}
                disabled={disabled}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={data.ingredient.id}>
                    {data.ingredient.name} (best match)
                  </SelectItem>
                  {data.alternatives
                    .filter((alt) => alt.id !== data.ingredient.id)
                    .map((alt) => (
                      <SelectItem key={alt.id} value={alt.id}>
                        {alt.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" onClick={handleConfirmBestMatch} disabled={disabled}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Matched (high confidence)
  const perServing = Math.round((data.totalQuantity / servings) * 10) / 10
  const isInvalidQuantity = !data.isVague && data.totalQuantity <= 0

  return (
    <div className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50/50 p-3 dark:border-green-900 dark:bg-green-950/20">
      <Check className="h-4 w-4 shrink-0 text-green-600" />
      <div className="flex-1">
        <Body>{data.ingredient.name}</Body>
        <Body variant="muted">
          {data.isVague && data.originalPhrase ? (
            <span className="italic">{data.originalPhrase}</span>
          ) : isInvalidQuantity ? (
            <span className="text-destructive">Quantity must be greater than 0</span>
          ) : (
            <>
              {perServing}
              {formatUnit(data.ingredient.defaultUnit)} per serving
            </>
          )}
        </Body>
      </div>
      <div className="flex items-center gap-2">
        {!data.isVague && (
          <>
            <Input
              type="number"
              value={data.totalQuantity}
              onChange={(e) => handleQuantityChange(parseFloat(e.target.value) || 0)}
              min={0.1}
              step="any"
              className={cn('w-24', isInvalidQuantity && 'border-destructive')}
              disabled={disabled}
            />
            <Body variant="muted">{formatUnit(data.ingredient.defaultUnit)}</Body>
          </>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={disabled}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

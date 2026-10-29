'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { Body } from '@/components/ui/typography'
import { ApiError, apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface CustomItemData {
  id: string
  name: string
  checked: boolean
  ingredientId: string | null
  ingredientCategory: string | null
  createdAt: string
  /**
   * YYYY-MM-DD: the earliest linked day extra from today on (HON-1310). Null
   * or absent for an item typed by hand, so it sits in the manual items section.
   */
  neededBy?: string | null
}

/** A staple as `GET /api/pantry/staples` sends it. */
export interface PantryStaple {
  id: string
  /** The name in the household's language. */
  name: string
  englishName: string
  quantity: number | null
}

export const PANTRY_STAPLES_KEY = ['pantry-staples'] as const

/** The most staples the dropdown lists at once. */
const MAX_SUGGESTIONS = 5

/**
 * `POST /api/shopping-list/custom`'s success body: the item, or the staple
 * the name marked ran out in its place (HON-1400).
 */
type CustomShoppingItemResponse =
  | { status: 'staple_ran_out'; pantryItemId: string; ingredientName: string }
  | { status?: undefined; item: CustomItemResponseItem }

interface CustomItemResponseItem {
  id: string
  name: string
  checked: boolean
  ingredientId: string | null
  ingredient?: { category: string } | null
  createdAt: string
}

/** What a sent name became; null when it was on the list already. */
type AddOutcome =
  | { kind: 'item'; item: CustomItemData }
  | { kind: 'staple'; pantryItemId: string; name: string }
  | null

interface CustomItemInputProps {
  onItemAdded: (item: CustomItemData) => void
  /** A staple the household picked or typed is now ran out (`quantity: 0`). */
  onStapleRanOut?: (pantryItemId: string) => void
  disabled?: boolean
}

/**
 * Staples not ran out yet whose name, in the household's language or in
 * English, contains the typed text. A staple ran out already is on the list.
 */
function matchingStaples(staples: PantryStaple[], typed: string): PantryStaple[] {
  const query = typed.trim().toLowerCase()
  if (!query) return []
  return staples
    .filter(
      (s) =>
        s.quantity !== 0 &&
        (s.name.toLowerCase().includes(query) || s.englishName.toLowerCase().includes(query)),
    )
    .slice(0, MAX_SUGGESTIONS)
}

export function CustomItemInput({ onItemAdded, onStapleRanOut, disabled }: CustomItemInputProps) {
  const tShopping = useTranslations('shopping')
  const tErrors = useTranslations('shopping.errors')
  const queryClient = useQueryClient()
  const [value, setValue] = useState('')
  // The dropdown opens when staples match; this tracks a dismissal (Escape,
  // leaving the field, or a pick).
  const [isDropdownDismissed, setIsDropdownDismissed] = useState(false)
  // -1 until the household moves with the arrow keys, so a plain Enter sends
  // the typed name and the server decides (HON-1400).
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  // Read when the field takes focus, not on page load, and again at each
  // focus: the pantry next to the list changes staples without telling this
  // query.
  const { data: staples = [], refetch: refetchStaples } = useQuery({
    queryKey: PANTRY_STAPLES_KEY,
    queryFn: () =>
      apiFetch<{ staples: PantryStaple[] }>('/api/pantry/staples').then((data) => data.staples),
    enabled: false,
  })
  const suggestions = matchingStaples(staples, value)
  const showDropdown = !isDropdownDismissed && suggestions.length > 0
  const activeIndex = highlightedIndex < suggestions.length ? highlightedIndex : -1
  const getOptionId = (index: number) => `${listboxId}-option-${index}`

  const handleStapleRanOut = (pantryItemId: string, name: string) => {
    toast.success(tShopping('stapleRanOutToast', { name }))
    setValue('')
    setHighlightedIndex(-1)
    // Written into the cache, not invalidated: a query with `enabled: false`
    // is not refetched by an invalidation, and the field keeps its focus.
    queryClient.setQueryData<PantryStaple[]>(PANTRY_STAPLES_KEY, (prev) =>
      prev?.map((s) => (s.id === pantryItemId ? { ...s, quantity: 0 } : s)),
    )
    onStapleRanOut?.(pantryItemId)
    inputRef.current?.focus()
  }

  // The pantry's Ran out button sends the same PATCH (HON-1399).
  const markRanOut = useMutation({
    mutationFn: (staple: PantryStaple) =>
      apiFetch(
        `/api/pantry/${staple.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: 0 }),
        },
        tErrors('markRanOutFailed'),
      ),
    onSuccess: (_data, staple) => handleStapleRanOut(staple.id, staple.name),
    onError: () => {
      toast.error(tErrors('markRanOutFailed'))
    },
  })

  const addItem = useMutation({
    mutationFn: async (name: string): Promise<AddOutcome> => {
      let data: CustomShoppingItemResponse
      try {
        data = await apiFetch<CustomShoppingItemResponse>(
          '/api/shopping-list/custom',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          },
          tErrors('addFailed'),
        )
      } catch (err) {
        // Already on the list is not a failure — say so and keep the input.
        if (err instanceof ApiError && err.status === 409) {
          toast.error(tErrors('alreadyOnList'))
          return null
        }
        throw err
      }

      if (data.status === 'staple_ran_out') {
        return { kind: 'staple', pantryItemId: data.pantryItemId, name: data.ingredientName }
      }

      const item: CustomItemData = {
        id: data.item.id,
        name: data.item.name,
        checked: data.item.checked,
        ingredientId: data.item.ingredientId,
        ingredientCategory: data.item.ingredient?.category ?? null,
        createdAt: data.item.createdAt,
      }
      return { kind: 'item', item }
    },
    onSuccess: (outcome) => {
      if (outcome?.kind === 'staple') {
        handleStapleRanOut(outcome.pantryItemId, outcome.name)
      } else if (outcome) {
        onItemAdded(outcome.item)
        setValue('')
        inputRef.current?.focus()
      }
    },
    onError: () => {
      toast.error(tErrors('addFailed'))
    },
  })

  const isSubmitting = addItem.isPending || markRanOut.isPending

  const pickStaple = (staple: PantryStaple) => {
    if (isSubmitting) return
    setIsDropdownDismissed(true)
    markRanOut.mutate(staple)
  }

  const handleSubmit = () => {
    const name = value.trim()
    if (!name || isSubmitting) return
    addItem.mutate(name)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && showDropdown) {
      e.preventDefault()
      setHighlightedIndex(Math.min(activeIndex + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp' && showDropdown) {
      e.preventDefault()
      setHighlightedIndex(Math.max(activeIndex - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const picked = showDropdown && activeIndex >= 0 ? suggestions[activeIndex] : undefined
      if (picked) pickStaple(picked)
      else handleSubmit()
    } else if (e.key === 'Escape' && showDropdown) {
      setIsDropdownDismissed(true)
      setHighlightedIndex(-1)
    }
  }

  return (
    <div className="relative">
      <Plus className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setIsDropdownDismissed(false)
          setHighlightedIndex(-1)
        }}
        onFocus={() => {
          setIsDropdownDismissed(false)
          void refetchStaples()
        }}
        onBlur={() => setIsDropdownDismissed(true)}
        onKeyDown={handleKeyDown}
        placeholder={tShopping('customInputPlaceholder')}
        className="pr-9 pl-9"
        // Not disabled while a request runs: a disabled field drops focus to
        // <body>. `handleSubmit` and `pickStaple` ignore input meanwhile.
        disabled={disabled}
        aria-busy={isSubmitting}
        aria-label={tShopping('customInputAria')}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={
          showDropdown && activeIndex >= 0 ? getOptionId(activeIndex) : undefined
        }
        aria-autocomplete="list"
      />
      {isSubmitting && (
        <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
      )}
      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={tShopping('stapleSuggestionsLabel')}
          className="bg-popover absolute top-full z-10 mt-1 w-full rounded-md border shadow-md"
        >
          {suggestions.map((staple, index) => (
            <button
              key={staple.id}
              id={getOptionId(index)}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              tabIndex={-1}
              // Keep focus in the field: the list closes once a staple is picked.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickStaple(staple)}
              className={cn(
                'flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors',
                'hover:bg-muted focus:bg-muted focus:outline-none',
                index > 0 && 'border-t',
                activeIndex === index && 'bg-muted',
              )}
            >
              <Body>{staple.name}</Body>
              <Body variant="muted">{tShopping('stapleSuggestionHint')}</Body>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

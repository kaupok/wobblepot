'use client'

import { useState, useRef } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { ApiError, apiFetch } from '@/lib/api'

export interface CustomItemData {
  id: string
  name: string
  checked: boolean
  ingredientId: string | null
  ingredientCategory: string | null
  createdAt: string
}

/** `POST /api/shopping-list/custom`'s success body. */
interface CustomShoppingItemResponse {
  item: {
    id: string
    name: string
    checked: boolean
    ingredientId: string | null
    ingredient?: { category: string } | null
    createdAt: string
  }
}

interface CustomItemInputProps {
  onItemAdded: (item: CustomItemData) => void
  disabled?: boolean
}

export function CustomItemInput({ onItemAdded, disabled }: CustomItemInputProps) {
  const tShopping = useTranslations('shopping')
  const tErrors = useTranslations('shopping.errors')
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addItem = useMutation({
    mutationFn: async (name: string): Promise<CustomItemData | null> => {
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

      return {
        id: data.item.id,
        name: data.item.name,
        checked: data.item.checked,
        ingredientId: data.item.ingredientId,
        ingredientCategory: data.item.ingredient?.category ?? null,
        createdAt: data.item.createdAt,
      }
    },
    onSuccess: (item) => {
      if (item) {
        onItemAdded(item)
        setValue('')
        inputRef.current?.focus()
      }
    },
    onError: () => {
      toast.error(tErrors('addFailed'))
    },
  })

  const isSubmitting = addItem.isPending

  const handleSubmit = () => {
    const name = value.trim()
    if (!name || isSubmitting) return
    addItem.mutate(name)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="relative">
      <Plus className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tShopping('customInputPlaceholder')}
        className="pr-9 pl-9"
        disabled={disabled || isSubmitting}
        aria-label={tShopping('customInputAria')}
      />
      {isSubmitting && (
        <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
      )}
    </div>
  )
}

'use client'

import { useState, useRef } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

export interface CustomItemData {
  id: string
  name: string
  checked: boolean
  ingredientId: string | null
  ingredientCategory: string | null
  createdAt: string
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
    mutationFn: async (name: string) => {
      const response = await fetch('/api/shopping-list/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 409) {
          toast.error(tErrors('alreadyOnList'))
          return null
        }
        throw new Error(data.error || tErrors('addFailed'))
      }

      return {
        id: data.item.id,
        name: data.item.name,
        checked: data.item.checked,
        ingredientId: data.item.ingredientId,
        ingredientCategory: data.item.ingredient?.category ?? null,
        createdAt: data.item.createdAt,
      } as CustomItemData
    },
    onSuccess: (item) => {
      if (item) {
        onItemAdded(item)
        setValue('')
        inputRef.current?.focus()
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : tErrors('addFailed')
      toast.error(message)
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

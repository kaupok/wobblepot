'use client'

import { useState, useRef } from 'react'
import { Plus, Loader2 } from 'lucide-react'
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
  const [value, setValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async () => {
    const name = value.trim()
    if (!name || isSubmitting) return

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/shopping-list/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 409) {
          toast.error('Item already on the list')
        } else {
          throw new Error(data.error || 'Failed to add item')
        }
        return
      }

      const item: CustomItemData = {
        id: data.item.id,
        name: data.item.name,
        checked: data.item.checked,
        ingredientId: data.item.ingredientId,
        ingredientCategory: data.item.ingredient?.category ?? null,
        createdAt: data.item.createdAt,
      }

      onItemAdded(item)
      setValue('')
      inputRef.current?.focus()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add item'
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
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
        placeholder="Add an item..."
        className="pr-9 pl-9"
        disabled={disabled || isSubmitting}
        aria-label="Add custom item to shopping list"
      />
      {isSubmitting && (
        <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
      )}
    </div>
  )
}

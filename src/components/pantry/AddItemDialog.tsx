'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { IngredientSearch, type IngredientResult } from './IngredientSearch'
import type { PantryItemData } from './PantryItem'

interface AddItemDialogProps {
  onItemAdded: (item: PantryItemData) => void
  buttonLabel?: string
}

export function AddItemDialog({ onItemAdded, buttonLabel = 'Add item' }: AddItemDialogProps) {
  const [open, setOpen] = useState(false)
  const [selectedIngredient, setSelectedIngredient] = useState<IngredientResult | null>(null)
  const [isStaple, setIsStaple] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [resetKey, setResetKey] = useState(0)

  const handleReset = () => {
    setSelectedIngredient(null)
    setIsStaple(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (newOpen) {
      // Increment reset key to clear search when dialog opens
      setResetKey((k) => k + 1)
    }
    if (!newOpen) {
      handleReset()
    }
  }

  const handleAdd = async () => {
    if (!selectedIngredient) return

    setIsAdding(true)
    try {
      const response = await fetch('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientId: selectedIngredient.id,
          isStaple,
        }),
      })

      if (!response.ok) {
        if (response.status === 409) {
          toast.error(`${selectedIngredient.name} is already in your pantry`)
          return
        }
        throw new Error('Failed to add item')
      }

      const data = await response.json()
      onItemAdded(data)
      setOpen(false)
      handleReset()
    } catch {
      toast.error('Failed to add item to pantry')
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          {buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to pantry</DialogTitle>
          <DialogDescription>Search for an ingredient to add to your pantry.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <IngredientSearch
            selectedIngredient={selectedIngredient}
            onSelect={setSelectedIngredient}
            resetKey={resetKey}
          />

          <div className="flex items-center gap-2">
            <Checkbox
              id="is-staple"
              checked={isStaple}
              onCheckedChange={(checked) => setIsStaple(checked === true)}
            />
            <Label htmlFor="is-staple" className="cursor-pointer text-sm">
              Mark as staple (always in stock)
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!selectedIngredient || isAdding}>
            {isAdding ? 'Adding...' : 'Add item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

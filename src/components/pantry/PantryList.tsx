'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { PantryItem, type PantryItemData } from './PantryItem'
import { AddItemDialog } from './AddItemDialog'

interface PantryListProps {
  initialItems: PantryItemData[]
}

export function PantryList({ initialItems }: PantryListProps) {
  const [items, setItems] = useState<PantryItemData[]>(initialItems)

  const staples = items.filter((item) => item.isStaple)
  const onHand = items.filter((item) => !item.isStaple)

  const handleToggleStaple = async (id: string, currentIsStaple: boolean) => {
    // Optimistic update
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isStaple: !currentIsStaple } : item)),
    )

    try {
      const response = await fetch(`/api/pantry/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isStaple: !currentIsStaple }),
      })

      if (!response.ok) {
        throw new Error('Failed to update item')
      }
    } catch {
      // Revert on error
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, isStaple: currentIsStaple } : item)),
      )
      toast.error('Failed to update item')
    }
  }

  const handleRemove = async (id: string) => {
    // Optimistic update
    const removedItem = items.find((item) => item.id === id)
    setItems((prev) => prev.filter((item) => item.id !== id))

    try {
      const response = await fetch(`/api/pantry/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to remove item')
      }

      toast.success('Item removed from pantry')
    } catch {
      // Revert on error
      if (removedItem) {
        setItems((prev) => [...prev, removedItem])
      }
      toast.error('Failed to remove item')
    }
  }

  const handleItemAdded = (newItem: PantryItemData) => {
    setItems((prev) => [...prev, newItem])
    toast.success('Item added to pantry')
  }

  if (items.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            <Heading variant="h2">Your pantry</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">Manage your household inventory</Body>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-8 text-center">
            <Body variant="muted">
              Your pantry is empty. Add staples like olive oil, salt, and rice to exclude them from
              shopping lists.
            </Body>
            <AddItemDialog onItemAdded={handleItemAdded} buttonLabel="Add staples" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle>
              <Heading variant="h2">Your pantry</Heading>
            </CardTitle>
            <CardDescription>
              <Body variant="muted">Manage your household inventory</Body>
            </CardDescription>
          </div>
          <AddItemDialog onItemAdded={handleItemAdded} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          {staples.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Body variant="small" className="text-muted-foreground">
                  Staples (always stocked)
                </Body>
                <Body variant="muted">
                  {staples.length} {staples.length === 1 ? 'item' : 'items'}
                </Body>
              </div>
              <div className="flex flex-col gap-2">
                {staples.map((item) => (
                  <PantryItem
                    key={item.id}
                    item={item}
                    onToggleStaple={handleToggleStaple}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </div>
          )}

          {onHand.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Body variant="small" className="text-muted-foreground">
                  On hand
                </Body>
                <Body variant="muted">
                  {onHand.length} {onHand.length === 1 ? 'item' : 'items'}
                </Body>
              </div>
              <div className="flex flex-col gap-2">
                {onHand.map((item) => (
                  <PantryItem
                    key={item.id}
                    item={item}
                    onToggleStaple={handleToggleStaple}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="border-t pt-4">
            <Body variant="muted" className="text-center">
              Mark items as staples to exclude them from shopping lists
            </Body>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

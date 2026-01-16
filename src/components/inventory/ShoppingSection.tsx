'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import type { IngredientCategory } from '@/generated/prisma/enums'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { CategoryGroup } from '@/components/shopping/CategoryGroup'
import { ShoppingEmptyState } from './ShoppingEmptyState'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'

interface ShoppingListGroup {
  category: IngredientCategory
  categoryLabel: string
  items: ShoppingItemData[]
}

interface ShoppingSectionProps {
  planId: string
  planStartDate: string
  planEndDate: string
  groups: ShoppingListGroup[]
  initialPurchasedIds: Set<string>
}

export function ShoppingSection({
  planId,
  planStartDate,
  planEndDate,
  groups,
  initialPurchasedIds,
}: ShoppingSectionProps) {
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(initialPurchasedIds)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())

  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0)
  const purchasedCount = purchasedIds.size

  const formatDateRange = (start: string, end: string) => {
    const startDate = new Date(start + 'T00:00:00')
    const endDate = new Date(end + 'T00:00:00')
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }

    const startStr = startDate.toLocaleDateString('en-US', options)
    const endStr = endDate.toLocaleDateString('en-US', options)
    const year = endDate.getFullYear()

    return `${startStr} - ${endStr}, ${year}`
  }

  const handleToggle = async (ingredientId: string, purchased: boolean) => {
    if (pendingIds.has(ingredientId)) return

    setPurchasedIds((prev) => {
      const next = new Set(prev)
      if (purchased) {
        next.add(ingredientId)
      } else {
        next.delete(ingredientId)
      }
      return next
    })
    setPendingIds((prev) => new Set(prev).add(ingredientId))

    try {
      const endpoint = purchased ? 'purchase' : 'unpurchase'
      const response = await fetch(`/api/meal-plans/${planId}/shopping-list/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update item')
      }
    } catch (error) {
      setPurchasedIds((prev) => {
        const next = new Set(prev)
        if (purchased) {
          next.delete(ingredientId)
        } else {
          next.add(ingredientId)
        }
        return next
      })

      const message = error instanceof Error ? error.message : 'Failed to update item'
      toast.error(message)
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(ingredientId)
        return next
      })
    }
  }

  // Check if all items are purchased
  if (purchasedCount === totalItems && totalItems > 0) {
    return <ShoppingEmptyState variant="all-purchased" />
  }

  const enhancedGroups = groups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      purchased: purchasedIds.has(item.ingredientId),
    })),
  }))

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-col gap-1">
          <CardTitle>
            <Heading variant="h2">Shopping list</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">For: {formatDateRange(planStartDate, planEndDate)}</Body>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          <div className="bg-muted/50 flex items-center justify-between rounded-lg px-4 py-3">
            <Body variant="muted">
              {totalItems} {totalItems === 1 ? 'item' : 'items'} • {purchasedCount} purchased
            </Body>
          </div>

          <div className="flex flex-col gap-6">
            {enhancedGroups.map((group) => (
              <CategoryGroup
                key={group.category}
                category={group.category}
                categoryLabel={group.categoryLabel}
                items={group.items}
                onToggleItem={handleToggle}
                disabled={pendingIds.size > 0}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

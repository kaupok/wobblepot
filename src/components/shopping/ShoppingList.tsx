'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import type { IngredientCategory } from '@/generated/prisma/enums'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'
import { CategoryGroup } from './CategoryGroup'
import { EmptyState } from './EmptyState'
import type { ShoppingItemData } from './ShoppingItem'

interface ShoppingListGroup {
  category: IngredientCategory
  categoryLabel: string
  items: ShoppingItemData[]
}

interface ShoppingListProps {
  planId: string
  planStartDate: string
  planEndDate: string
  groups: ShoppingListGroup[]
  initialPurchasedIds: Set<string>
}

export function ShoppingList({
  planId,
  planStartDate,
  planEndDate,
  groups,
  initialPurchasedIds,
}: ShoppingListProps) {
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(initialPurchasedIds)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())

  // Calculate totals
  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0)
  const purchasedCount = purchasedIds.size

  // Format date range for display
  const formatDateRange = (start: string, end: string) => {
    const startDate = new Date(start + 'T00:00:00')
    const endDate = new Date(end + 'T00:00:00')
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }

    const startStr = startDate.toLocaleDateString('en-US', options)
    const endStr = endDate.toLocaleDateString('en-US', options)
    const year = endDate.getFullYear()

    return `${startStr} - ${endStr}, ${year}`
  }

  // Handle toggle with optimistic updates
  const handleToggle = async (ingredientId: string, purchased: boolean) => {
    // Prevent double clicks
    if (pendingIds.has(ingredientId)) return

    // Optimistic update
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
      // Revert on error
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
    return <EmptyState variant="all-purchased" />
  }

  // Enhance groups with current purchase state
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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle>
              <Heading variant="h2">Shopping list</Heading>
            </CardTitle>
            <CardDescription>
              <Body variant="muted">For: {formatDateRange(planStartDate, planEndDate)}</Body>
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to plan
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          {/* Summary bar */}
          <div className="bg-muted/50 flex items-center justify-between rounded-lg px-4 py-3">
            <Button variant="outline" size="sm" asChild>
              <Link href="/pantry">View pantry</Link>
            </Button>
            <Body variant="muted">
              {totalItems} {totalItems === 1 ? 'item' : 'items'} • {purchasedCount} purchased
            </Body>
          </div>

          {/* Category groups */}
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

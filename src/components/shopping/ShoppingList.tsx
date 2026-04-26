'use client'

import { toast } from 'sonner'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { IngredientCategory } from '@/generated/prisma/enums'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { CategoryGroup } from './CategoryGroup'
import type { ShoppingItemData } from './ShoppingItem'
import { track } from '@/lib/analytics'

interface ShoppingListGroup {
  category: IngredientCategory
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
  const queryClient = useQueryClient()
  const queryKey = ['shopping-list', planId, 'purchased']

  // Seed cache with server-provided data; no real queryFn needed
  const { data: purchasedIds = initialPurchasedIds } = useQuery({
    queryKey,
    queryFn: () => initialPurchasedIds,
    initialData: initialPurchasedIds,
    staleTime: Infinity,
  })

  const togglePurchase = useMutation({
    mutationFn: async ({
      ingredientId,
      purchased,
    }: {
      ingredientId: string
      purchased: boolean
    }) => {
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
    },
    onMutate: async ({ ingredientId, purchased }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey })

      // Snapshot the previous value
      const previousIds = queryClient.getQueryData<Set<string>>(queryKey)

      // Optimistically update the cache
      queryClient.setQueryData<Set<string>>(queryKey, (old) => {
        const next = new Set(old)
        if (purchased) {
          next.add(ingredientId)
        } else {
          next.delete(ingredientId)
        }
        return next
      })

      return { previousIds }
    },
    onSuccess: (_data, { purchased }) => {
      // Spec: only fire on the purchased transition, not unpurchase. The
      // unpurchase event would dilute the funnel without adding a question
      // we currently want to answer.
      if (purchased) {
        void track('shopping:item_purchased', { source: 'shopping_list' })
      }
    },
    onError: (_err, _vars, context) => {
      // Revert to snapshot on error
      if (context?.previousIds) {
        queryClient.setQueryData(queryKey, context.previousIds)
      }
      toast.error(_err instanceof Error ? _err.message : 'Failed to update item')
    },
  })

  const handleToggle = (ingredientId: string, purchased: boolean) => {
    // Prevent double clicks on the same item
    if (togglePurchase.isPending && togglePurchase.variables?.ingredientId === ingredientId) return
    togglePurchase.mutate({ ingredientId, purchased })
  }

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

  // Check if all items are purchased - return null, parent should handle
  if (purchasedCount === totalItems && totalItems > 0) {
    return null
  }

  // Track pending item IDs from in-flight mutations
  const pendingIds = new Set<string>()
  if (togglePurchase.isPending && togglePurchase.variables) {
    pendingIds.add(togglePurchase.variables.ingredientId)
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
        <div className="flex flex-col gap-1">
          <Heading variant="h4">Shopping list</Heading>
          <Body variant="muted">For: {formatDateRange(planStartDate, planEndDate)}</Body>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          {/* Summary bar */}
          <div className="bg-muted/50 flex items-center justify-end rounded-lg px-4 py-3">
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
                items={group.items}
                onToggleItem={handleToggle}
                pendingIds={pendingIds}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { IngredientCategory } from '@/generated/prisma/enums'
import { Button } from '@/components/ui/button'
import { PantrySection } from './PantrySection'
import { ShoppingSection } from './ShoppingSection'
import { ShoppingEmptyState, type ShoppingEmptyStateVariant } from './ShoppingEmptyState'
import type { PantryItemData } from '@/components/pantry/PantryItem'
import type { ShoppingItemData } from '@/components/shopping/ShoppingItem'

interface ShoppingListGroup {
  category: IngredientCategory
  categoryLabel: string
  items: ShoppingItemData[]
}

interface ShoppingData {
  planId: string
  planStartDate: string
  planEndDate: string
  groups: ShoppingListGroup[]
  initialPurchasedIds: Set<string>
}

interface InventoryPageProps {
  pantryItems: PantryItemData[]
  shoppingData: ShoppingData | null
  emptyStateVariant?: ShoppingEmptyStateVariant
}

export function InventoryPage({
  pantryItems,
  shoppingData,
  emptyStateVariant,
}: InventoryPageProps) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return (
    <div className="container mx-auto max-w-6xl p-4">
      <div className="mb-4 flex items-center justify-between md:hidden">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to plan
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Pantry section - on mobile it's collapsible and comes second, on desktop it's first */}
        <div className="order-2 md:order-1">
          <PantrySection
            initialItems={pantryItems}
            defaultOpen={!isMobile}
            collapsible={isMobile}
          />
        </div>

        {/* Shopping section - primary content, always first on mobile */}
        <div className="order-1 md:order-2">
          {emptyStateVariant ? (
            <ShoppingEmptyState variant={emptyStateVariant} />
          ) : shoppingData ? (
            <ShoppingSection
              planId={shoppingData.planId}
              planStartDate={shoppingData.planStartDate}
              planEndDate={shoppingData.planEndDate}
              groups={shoppingData.groups}
              initialPurchasedIds={shoppingData.initialPurchasedIds}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

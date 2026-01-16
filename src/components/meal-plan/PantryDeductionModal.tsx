'use client'

import { useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import type { MealComponent, PantryItemFull, PantryDeductionItem } from './types'

interface PantryDeductionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mealName: string
  components: MealComponent[]
  householdSize: number
  pantryItems: PantryItemFull[]
  onConfirm: () => void
  isLoading?: boolean
}

export function computeDeductions(
  components: MealComponent[],
  householdSize: number,
  pantryItems: PantryItemFull[],
): PantryDeductionItem[] {
  const pantryMap = new Map(pantryItems.map((item) => [item.ingredientId, item]))

  const deductions: PantryDeductionItem[] = []

  for (const component of components) {
    const pantryItem = pantryMap.get(component.ingredientId)

    // Skip if not in pantry
    if (!pantryItem) continue

    // Skip staples (never deduct)
    if (pantryItem.isStaple) continue

    const deductionAmount = component.quantityPerServing * householdSize
    const currentQuantity = pantryItem.quantity

    // If quantity is null, treat as "will be fully consumed"
    if (currentQuantity === null) {
      deductions.push({
        ingredientId: component.ingredientId,
        ingredientName: component.ingredient.name,
        unit: component.ingredient.defaultUnit,
        currentQuantity: null,
        deductionAmount,
        newQuantity: null,
        willBeRemoved: true,
      })
      continue
    }

    const newQuantity = currentQuantity - deductionAmount

    deductions.push({
      ingredientId: component.ingredientId,
      ingredientName: component.ingredient.name,
      unit: component.ingredient.defaultUnit,
      currentQuantity,
      deductionAmount,
      newQuantity: newQuantity <= 0 ? null : newQuantity,
      willBeRemoved: newQuantity <= 0,
    })
  }

  return deductions
}

function formatQuantity(quantity: number | null, unit: 'g' | 'piece'): string {
  if (quantity === null) return 'some'
  if (unit === 'piece') {
    return quantity === 1 ? '1 piece' : `${quantity} pieces`
  }
  return `${Math.round(quantity)}g`
}

export function PantryDeductionModal({
  open,
  onOpenChange,
  mealName,
  components,
  householdSize,
  pantryItems,
  onConfirm,
  isLoading = false,
}: PantryDeductionModalProps) {
  const deductions = useMemo(
    () => computeDeductions(components, householdSize, pantryItems),
    [components, householdSize, pantryItems],
  )

  const hasDeductions = deductions.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as completed</DialogTitle>
          <DialogDescription>
            {hasDeductions
              ? `Marking "${mealName}" as completed will deduct the following from your pantry:`
              : `Mark "${mealName}" as completed? No pantry items will be affected.`}
          </DialogDescription>
        </DialogHeader>

        {hasDeductions && (
          <div className="max-h-60 overflow-y-auto">
            <ul className="space-y-2">
              {deductions.map((item) => (
                <li key={item.ingredientId} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{item.ingredientName}</span>
                  <span className="text-muted-foreground">
                    {formatQuantity(item.currentQuantity, item.unit)}
                    {' → '}
                    {item.willBeRemoved ? (
                      <span className="text-destructive">remove</span>
                    ) : (
                      formatQuantity(item.newQuantity, item.unit)
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!hasDeductions && (
          <Body variant="muted">
            Either all ingredients are staples, not in your pantry, or the meal has no ingredients.
          </Body>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isLoading}>
            {isLoading ? 'Updating...' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
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

type FormatQuantityFn = (quantity: number | null, unit: 'g' | 'piece') => string

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
  const t = useTranslations('meal-plan.deduction')
  const tCommon = useTranslations('common')

  const formatQuantity: FormatQuantityFn = (quantity, unit) => {
    if (quantity === null) return t('someQuantity')
    if (unit === 'piece') {
      return t('pieceQuantity', { count: quantity })
    }
    return t('gramsQuantity', { count: Math.round(quantity) })
  }

  const deductions = useMemo(
    () => computeDeductions(components, householdSize, pantryItems),
    [components, householdSize, pantryItems],
  )

  const hasDeductions = deductions.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {hasDeductions ? t('willDeduct', { mealName }) : t('noDeduction', { mealName })}
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
                      <span className="text-destructive">{t('remove')}</span>
                    ) : (
                      formatQuantity(item.newQuantity, item.unit)
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!hasDeductions && <Body variant="muted">{t('noPantryItemsBody')}</Body>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={isLoading}>
            {isLoading ? t('updating') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

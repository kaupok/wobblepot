'use client'

import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { type MealComponent, formatUnit } from './meal-form-types'
import type { Unit } from '@/generated/prisma/enums'

interface ComponentListProps {
  components: MealComponent[]
  servings: number
  disabled: boolean
  duplicateMap: Map<string, number[]>
  onRemove: (ingredientId: string) => void
  onUpdateQuantity: (ingredientId: string, quantity: number) => void
  onSetQuantity: (ingredientId: string, defaultUnit: Unit) => void
  onMarkAsVague: (ingredientId: string) => void
}

export function ComponentList({
  components,
  servings,
  disabled,
  duplicateMap,
  onRemove,
  onUpdateQuantity,
  onSetQuantity,
  onMarkAsVague,
}: ComponentListProps) {
  if (components.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {components.map((comp, index) => {
        const isInvalidQuantity = !comp.isVague && comp.totalQuantity <= 0
        const unitLabel = formatUnit(comp.ingredient.defaultUnit)
        const duplicateIndices = duplicateMap.get(comp.ingredientId)
        const isDuplicate = duplicateIndices && duplicateIndices.length > 1
        const otherIndices = isDuplicate ? duplicateIndices.filter((i) => i !== index) : []
        return (
          <div key={index} className="flex items-center gap-3 rounded-md border p-3">
            <div className="flex-1">
              <Body>{comp.ingredient.name}</Body>
              <Body variant="muted">
                {comp.isVague && comp.originalPhrase ? (
                  <span className="italic">{comp.originalPhrase}</span>
                ) : isInvalidQuantity ? (
                  <span className="text-destructive">Quantity must be greater than 0</span>
                ) : (
                  <>
                    {Math.round((comp.totalQuantity / servings) * 10) / 10}
                    {unitLabel} per serving
                  </>
                )}
              </Body>
              {isDuplicate && (
                <div className="mt-1 flex items-center gap-1.5">
                  <Info className="h-3 w-3 shrink-0 text-amber-600" />
                  <Body variant="small" className="text-amber-700 dark:text-amber-400">
                    Also used in row{otherIndices.length > 1 ? 's' : ''}{' '}
                    {otherIndices.map((i) => i + 1).join(', ')}
                  </Body>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {comp.isVague ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onSetQuantity(comp.ingredientId, comp.ingredient.defaultUnit)}
                  disabled={disabled}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Set quantity
                </Button>
              ) : (
                <>
                  <div
                    className={cn(
                      'flex items-center rounded-md border',
                      isInvalidQuantity ? 'border-destructive' : 'border-input',
                    )}
                  >
                    <Input
                      type="number"
                      value={comp.totalQuantity}
                      onChange={(e) =>
                        onUpdateQuantity(comp.ingredientId, parseFloat(e.target.value) || 0)
                      }
                      min={0.1}
                      step="any"
                      className="w-20 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                      disabled={disabled}
                      aria-label={`Total quantity for ${comp.ingredient.name}`}
                    />
                    {unitLabel && (
                      <span className="text-muted-foreground bg-muted border-l px-2 py-1.5 text-sm">
                        {unitLabel}
                      </span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onMarkAsVague(comp.ingredientId)}
                    disabled={disabled}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    No quantity
                  </Button>
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemove(comp.ingredientId)}
                disabled={disabled}
              >
                ×
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

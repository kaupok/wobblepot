'use client'

import { useMemo, useState } from 'react'

import type { IngredientRowData } from '@/components/recipes/IngredientRow'
import type { ProteinType } from '@/generated/prisma/enums'
import {
  type ComponentForProtein,
  deriveProteinType,
  distinctProteinTypes,
} from '@/lib/meal-planning/protein'

import type { MealComponent } from './meal-form-types'

interface UseMainProteinOptions {
  /** The stored choice when editing; null or absent is automatic. */
  initial?: ProteinType | null
  isImportMode: boolean
  components: MealComponent[]
  ingredientRows: IngredientRowData[]
  servingsNum: number
}

/**
 * The recipe form's "Main protein" choice (HON-1386). The automatic value is
 * derived live, by the rule the server applies on save, from the rows the
 * save would send: plain components, or the matched import rows. The choice
 * is offered only when those rows carry two or more protein types, and it
 * falls back to automatic when an ingredient change removes its type, so the
 * form never sends a choice the server would refuse.
 */
export function useMainProtein({
  initial,
  isImportMode,
  components,
  ingredientRows,
  servingsNum,
}: UseMainProteinOptions) {
  const proteinComponents = useMemo((): ComponentForProtein[] => {
    const rows = isImportMode
      ? ingredientRows.flatMap((row) => (row.type === 'matched' ? [row] : []))
      : components.map((c) => ({ ...c, totalQuantity: c.totalQuantity ?? 0 }))
    return rows.map((row) => ({
      quantityPerServing: row.totalQuantity / servingsNum,
      isVague: row.isVague,
      ingredient: { ...row.ingredient, protein: row.ingredient.protein ?? 0 },
    }))
  }, [isImportMode, ingredientRows, components, servingsNum])

  const options = distinctProteinTypes(proteinComponents)
  const automatic = deriveProteinType(proteinComponents)
  const visible = options.length >= 2

  const [choice, setChoice] = useState<ProteinType | null>(initial ?? null)
  // Reset during render rather than in an effect, so no frame shows a choice
  // the rows no longer carry.
  if (choice !== null && (!visible || !options.includes(choice))) setChoice(null)

  return { visible, options, automatic, choice, setChoice }
}

export type MainProteinState = ReturnType<typeof useMainProtein>

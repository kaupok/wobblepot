// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { IngredientRowData } from '@/components/recipes/IngredientRow'
import { useMainProtein } from './use-main-protein'

const mince = {
  id: 'mince',
  name: 'Beef mince',
  category: 'protein' as const,
  defaultUnit: 'g' as const,
  protein: 26,
  proteinType: 'beef' as const,
}
const beans = {
  id: 'beans',
  name: 'Kidney beans',
  category: 'legume' as const,
  defaultUnit: 'g' as const,
  protein: 8.7,
  proteinType: 'legume' as const,
}

function importRows(rows: IngredientRowData[]) {
  return renderHook(() =>
    useMainProtein({ isImportMode: true, components: [], ingredientRows: rows, servingsNum: 3 }),
  ).result.current
}

describe('useMainProtein on imported rows', () => {
  it('derives from the matched rows, as the save would send them', () => {
    const state = importRows([
      { type: 'matched', ingredient: mince, totalQuantity: 75 },
      { type: 'matched', ingredient: beans, totalQuantity: 400 },
    ])

    expect(state).toMatchObject({ visible: true, options: ['beef', 'legume'], automatic: 'legume' })
  })

  it('leaves out a low-confidence row, which must be confirmed before a save', () => {
    const state = importRows([
      { type: 'matched', ingredient: mince, totalQuantity: 75 },
      {
        type: 'low-confidence',
        extractedName: 'beans',
        ingredient: beans,
        alternatives: [],
        totalQuantity: 400,
      },
    ])

    expect(state).toMatchObject({ visible: false, options: ['beef'], automatic: 'beef' })
  })

  it('skips a vague row', () => {
    const state = importRows([
      { type: 'matched', ingredient: mince, totalQuantity: 75 },
      { type: 'matched', ingredient: beans, totalQuantity: 0, isVague: true },
    ])

    expect(state).toMatchObject({ visible: false, options: ['beef'] })
  })
})

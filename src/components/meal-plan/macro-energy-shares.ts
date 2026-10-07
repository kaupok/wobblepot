import type { CSSProperties } from 'react'

/** The three macros, in the order the split bar draws them (HON-1109). */
export const MACROS = ['protein', 'carbs', 'fat'] as const

export type Macro = (typeof MACROS)[number]

export type MacroGrams = Record<Macro, number>

/** Energy per gram: the Atwater factors. */
const KCAL_PER_GRAM: Record<Macro, number> = { protein: 4, carbs: 4, fat: 9 }

/**
 * Each macro's share of the meal's energy, in whole percentages that sum to
 * 100 (largest-remainder rounding), or all 0 when the macros carry no energy.
 *
 * The shares come from the macros alone, not from the stored calories: those
 * can differ from the 4/4/9 sum because of rounding and fibre, and neither
 * value is "corrected" to match the other.
 */
export function macroEnergyShares(grams: MacroGrams): MacroGrams {
  const kcal = MACROS.map((macro) => {
    const value = grams[macro]
    return Number.isFinite(value) && value > 0 ? value * KCAL_PER_GRAM[macro] : 0
  })
  const total = kcal.reduce((sum, value) => sum + value, 0)
  if (total === 0) return { protein: 0, carbs: 0, fat: 0 }

  const exact = kcal.map((value) => (value / total) * 100)
  const shares = exact.map(Math.floor)
  let left = 100 - shares.reduce((sum, value) => sum + value, 0)
  // Hand the points lost to flooring to the largest remainders. A stable sort,
  // so a tie goes to the macro drawn first.
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder)
  for (const { index } of byRemainder) {
    if (left === 0) break
    shares[index]! += 1
    left -= 1
  }
  return { protein: shares[0]!, carbs: shares[1]!, fat: shares[2]! }
}

/** The narrowest a part of the bar gets, so a 2% part stays visible. */
const MIN_PART_PX = 4

/**
 * The split bar's column template, one `fr` track per drawn part, as the
 * `style` value read by the `grid-cols-macro-split` utility in globals.css.
 * Data-driven, so it cannot be a class (`shadcn/no-arbitrary-values`).
 */
export function macroSplitStyle(shares: number[]): CSSProperties {
  return { '--macro-split': macroSplitTemplate(shares) } as CSSProperties
}

function macroSplitTemplate(shares: number[]): string {
  return shares.map((share) => `minmax(${MIN_PART_PX}px, ${share}fr)`).join(' ')
}

/**
 * The legend's Carbs label centre, a CSS length (`48%` before measurement,
 * `112.5px` after), as the `style` value read by the `left-macro-carbs`
 * utility in globals.css (HON-1114). Data-driven, like `macroSplitStyle`.
 */
export function macroCarbsStyle(centre: string): CSSProperties {
  return { '--macro-carbs-x': centre } as CSSProperties
}

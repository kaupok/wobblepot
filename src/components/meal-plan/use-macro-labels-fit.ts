'use client'

import { useLayoutEffect, useState, type RefObject } from 'react'

/** Half a pixel of slack, so subpixel rounding does not cost the aligned layout. */
const SLACK_PX = 0.5

/**
 * Whether every label fits its part of the bar: each label's widest line
 * (grams or name) at most as wide as the part above it. `parts` and `labels`
 * are in the same macro order. A part not laid out yet (width 0) tells
 * nothing, so it reads as a fit.
 */
export function labelsFit(parts: number[], labels: number[]): boolean {
  return parts.every((part, index) => part === 0 || (labels[index] ?? 0) <= part + SLACK_PX)
}

/**
 * Whether the nutrition legend can sit under its own parts of the split bar
 * (HON-1109). A label wider than its part ("Süsivesikud" over 22%, carbs at 4%
 * in a low-carb meal) switches the legend to the pinned row, so this measures.
 *
 * Reads, inside `root`, each `[data-macro-part]` (the bar's parts, laid out the
 * same in both modes) and each `[data-macro-text]` (the grams and the name,
 * `width: max-content`, so their width is their text's). Neither depends on the
 * mode, so the switch cannot feed back into the next measurement, and a wider
 * card switches back to aligned.
 *
 * True until measured, so the server renders the aligned legend. `enabled` is
 * false when no aligned layout is possible (a macro at 0g has no part).
 * `layoutKey` changes whenever the parts or the label text do (new grams in
 * the recipe form, another locale) without the root's size changing.
 */
export function useMacroLabelsFit(
  root: RefObject<HTMLElement | null>,
  enabled: boolean,
  layoutKey: string,
): boolean {
  const [fits, setFits] = useState(true)

  useLayoutEffect(() => {
    const element = root.current
    if (!enabled || !element || typeof ResizeObserver === 'undefined') return

    const measure = () => {
      const parts = [...element.querySelectorAll<HTMLElement>('[data-macro-part]')]
      const labels = parts.map((part) => {
        const texts = element.querySelectorAll<HTMLElement>(
          `[data-macro-text="${part.dataset.macroPart}"]`,
        )
        return Math.max(0, ...[...texts].map((text) => text.getBoundingClientRect().width))
      })
      setFits(
        labelsFit(
          parts.map((part) => part.getBoundingClientRect().width),
          labels,
        ),
      )
    }
    measure()
    // The parts change width with the card; the labels with text zoom and a
    // late web font.
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.querySelectorAll('[data-macro-text]').forEach((text) => observer.observe(text))
    return () => observer.disconnect()
    // `fits` too: the switch re-renders the labels as new elements, and the
    // observer has to watch those. The re-measure finds the same answer.
  }, [root, enabled, layoutKey, fits])

  return fits
}

'use client'

import { useLayoutEffect, useState, type RefObject } from 'react'

/** The least room between two legend labels, in px (HON-1114). */
export const LABEL_GAP_PX = 16

/** Half a pixel of slack, so subpixel rounding does not re-render the legend. */
const SLACK_PX = 0.5

interface MiddleLabelInput {
  /** The legend row's width. */
  rowWidth: number
  /** The middle part's centre, from the row's left edge. */
  partCentre: number
  /** The three labels' widths, start to end. */
  labelWidths: readonly [number, number, number]
  /** The least room between two labels. */
  gap: number
}

/**
 * Where the middle legend label starts, from the row's left edge: centred on
 * its part, then clamped so it keeps `gap` to the first label (flush left) and
 * the last (flush right). `null` when the three labels and two gaps are wider
 * than the row, so the legend falls back to a plain row.
 */
export function placeMiddleLabel({
  rowWidth,
  partCentre,
  labelWidths: [start, middle, end],
  gap,
}: MiddleLabelInput): number | null {
  const min = start + gap
  const max = rowWidth - end - gap - middle
  if (min > max + SLACK_PX) return null
  return Math.min(Math.max(partCentre - middle / 2, min), Math.max(min, max))
}

export interface MacroLegendPlacement {
  /** The carbs label's centre in px from the row's left edge; `null` until measured. */
  carbsCentre: number | null
  /** The labels do not fit with their gaps, so they sit in a plain row. */
  fallback: boolean
}

const UNMEASURED: MacroLegendPlacement = { carbsCentre: null, fallback: false }

function sameMeasurement(a: MacroLegendPlacement, b: MacroLegendPlacement): boolean {
  if (a.fallback !== b.fallback) return false
  if (a.carbsCentre === null || b.carbsCentre === null) return a.carbsCentre === b.carbsCentre
  return Math.abs(a.carbsCentre - b.carbsCentre) <= SLACK_PX
}

/**
 * Where the nutrition legend's Carbs label sits (HON-1114). Protein is flush
 * left and Fat flush right in every layout, so only Carbs moves: centred under
 * the carbs part, clamped to keep 16px from both neighbours.
 *
 * Reads, inside `row`, each `[data-macro]` label (`width: max-content`, so its
 * width is its text's and does not depend on where it sits), and the bar's
 * `[data-macro-part]` elements inside `root`. A carbs part at 0g is not drawn,
 * so Carbs centres on the boundary between the protein and fat parts (or the
 * row's middle, with no bar at all).
 *
 * Unmeasured on the server and in jsdom: the caller places Carbs by the energy
 * shares, and the layout effect corrects it before paint. `layoutKey` changes
 * whenever the parts or the label text do (new grams in the recipe form,
 * another locale) without the root's size changing.
 */
export function useMacroLegendPlacement(
  root: RefObject<HTMLElement | null>,
  row: RefObject<HTMLElement | null>,
  layoutKey: string,
): MacroLegendPlacement {
  const [placement, setPlacement] = useState<MacroLegendPlacement>(UNMEASURED)

  useLayoutEffect(() => {
    const rootElement = root.current
    const rowElement = row.current
    if (!rootElement || !rowElement || typeof ResizeObserver === 'undefined') return

    const width = (selector: string) =>
      rowElement.querySelector<HTMLElement>(selector)?.getBoundingClientRect().width ?? 0
    const part = (macro: string) =>
      rootElement
        .querySelector<HTMLElement>(`[data-macro-part="${macro}"]`)
        ?.getBoundingClientRect()

    const measure = () => {
      const rowBox = rowElement.getBoundingClientRect()
      if (rowBox.width === 0 || rowElement.offsetWidth === 0) return
      // Client rects include transforms, and the cook view's dialog opens
      // with a zoom. The result is a CSS length, so divide the scale back out:
      // a ResizeObserver does not fire when only a transform ends.
      const scale = rowBox.width / rowElement.offsetWidth
      const carbs = part('carbs')
      const partCentre =
        (carbs
          ? carbs.left + carbs.width / 2 - rowBox.left
          : ((part('protein')?.right ?? rowBox.left) + (part('fat')?.left ?? rowBox.right)) / 2 -
            rowBox.left) / scale
      const labelWidths = [
        width('[data-macro="protein"]') / scale,
        width('[data-macro="carbs"]') / scale,
        width('[data-macro="fat"]') / scale,
      ] as const
      const x = placeMiddleLabel({
        rowWidth: rowElement.offsetWidth,
        partCentre,
        labelWidths,
        gap: LABEL_GAP_PX,
      })
      const next: MacroLegendPlacement =
        x === null
          ? { carbsCentre: null, fallback: true }
          : { carbsCentre: x + labelWidths[1] / 2, fallback: false }
      setPlacement((previous) => (sameMeasurement(previous, next) ? previous : next))
    }
    measure()
    // The parts change with the card's width; the labels with text zoom and a
    // late web font. The labels stay the same elements in every layout, so
    // this one observer keeps watching them.
    const observer = new ResizeObserver(measure)
    observer.observe(rootElement)
    rowElement.querySelectorAll('[data-macro]').forEach((label) => observer.observe(label))
    return () => observer.disconnect()
  }, [root, row, layoutKey])

  return placement
}

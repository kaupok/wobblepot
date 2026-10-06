'use client'

import { useLayoutEffect, useState, type RefObject } from 'react'

/** The most description lines a planner card shows (HON-1096). */
export const MAX_DESCRIPTION_LINES = 2

export type DescriptionLines = 0 | 1 | 2

/**
 * The whole description lines that fit under the name in the card's text
 * block: the block's minimum height less the name's height, in description
 * lines, at most two. Half a pixel of slack, so a name measured at 56.01px for
 * two 28px lines does not cost a line.
 */
export function descriptionLines(
  blockMinHeight: number,
  nameHeight: number,
  lineHeight: number,
): DescriptionLines {
  if (!(lineHeight > 0)) return MAX_DESCRIPTION_LINES
  const lines = Math.floor((blockMinHeight - nameHeight + 0.5) / lineHeight)
  return Math.max(0, Math.min(MAX_DESCRIPTION_LINES, lines)) as DescriptionLines
}

/**
 * The description's classes for its lines: hidden on a narrow card, where the
 * name column is half a phone card and prose in it would run on, and from the
 * card's `@md` clamped to its lines, with the ellipsis on the last; hidden at
 * none.
 */
export const DESCRIPTION_CLAMP = {
  0: 'hidden',
  1: 'hidden @md/meal-image:line-clamp-1',
  2: 'hidden @md/meal-image:line-clamp-2',
} as const satisfies Record<DescriptionLines, string>

interface UseDescriptionLinesOptions {
  /** The text block, whose `min-height` is the room for the name and the description. */
  blockRef: RefObject<HTMLElement | null>
  /** The name, never clamped. */
  nameRef: RefObject<HTMLElement | null>
  /** The description's wrapper; its first child carries the line height. */
  descriptionRef: RefObject<HTMLElement | null>
  /**
   * Whether the description renders. The refs do not change identity when it
   * first appears (a swap to a meal with one, an empty slot filled), so this
   * is what attaches the measuring then.
   */
  hasDescription: boolean
}

/**
 * How many lines the planner card's description gets (HON-1096). The text
 * block has a fixed minimum height, the name always shows in full, and the
 * description takes the whole lines left under it. CSS cannot clamp to "the
 * lines left", so this measures. None of the inputs is the description's own
 * height, so the clamp it sets cannot feed back into the next measurement.
 *
 * Two lines until measured, the most a name of two lines or fewer leaves.
 */
export function useDescriptionLines({
  blockRef,
  nameRef,
  descriptionRef,
  hasDescription,
}: UseDescriptionLinesOptions): DescriptionLines {
  const [lines, setLines] = useState<DescriptionLines>(MAX_DESCRIPTION_LINES)

  useLayoutEffect(() => {
    const block = blockRef.current
    const name = nameRef.current
    const description = descriptionRef.current
    if (!block || !name || !description || typeof ResizeObserver === 'undefined') return

    const measure = () => {
      const text = description.firstElementChild ?? description
      setLines(
        descriptionLines(
          parseFloat(getComputedStyle(block).minHeight) || 0,
          name.getBoundingClientRect().height,
          parseFloat(getComputedStyle(text).lineHeight),
        ),
      )
    }
    measure()
    // The name rewraps when the card's width changes, and the block's minimum
    // height steps at the container query; text zoom changes both.
    const observer = new ResizeObserver(measure)
    observer.observe(block)
    observer.observe(name)
    return () => observer.disconnect()
  }, [blockRef, nameRef, descriptionRef, hasDescription])

  return lines
}

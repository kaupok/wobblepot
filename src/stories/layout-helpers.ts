import { expect } from 'storybook/test'

/**
 * Layout assertions for play functions that guard against wrapping and
 * overflow regressions (HON-692). Axe cannot see either, and a snapshot of
 * the DOM looks identical whether a label fits on one line or on four.
 */

/**
 * Number of rendered lines an element's text occupies. Only text nodes are
 * measured: a padded inline-flex child (a button) reports a taller box that
 * starts above the line's text and would read as a second line. Rects whose
 * tops sit within half a line of each other share a line.
 */
function renderedLineCount(el: HTMLElement): number {
  const rects: DOMRect[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue
    range.selectNodeContents(node)
    rects.push(...Array.from(range.getClientRects()).filter((r) => r.width > 0))
  }
  const tops = rects.map((r) => r.top).sort((a, b) => a - b)
  let lineTop = tops[0]
  if (lineTop === undefined) return 0
  const tolerance = Math.min(...rects.map((r) => r.height)) / 2
  let lines = 1
  for (const top of tops) {
    if (top - lineTop > tolerance) {
      lines += 1
      lineTop = top
    }
  }
  return lines
}

/** Asserts the element's text renders on a single line. */
export function expectSingleLine(el: HTMLElement): void {
  expect(renderedLineCount(el), `"${el.textContent}" wraps`).toBe(1)
}

/** Asserts the element sits horizontally within the container's box. */
export function expectWithinHorizontally(el: HTMLElement, container: HTMLElement): void {
  const box = el.getBoundingClientRect()
  const bounds = container.getBoundingClientRect()
  expect(box.left, `"${el.textContent}" overflows left`).toBeGreaterThanOrEqual(bounds.left - 0.5)
  expect(box.right, `"${el.textContent}" overflows right`).toBeLessThanOrEqual(bounds.right + 0.5)
}

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

/** Asserts the element's text renders on at most `max` lines. */
export function expectAtMostLines(el: HTMLElement, max: number): void {
  expect(renderedLineCount(el), `"${el.textContent}" wraps past ${max} lines`).toBeLessThanOrEqual(
    max,
  )
}

/** Asserts the element sits horizontally within the container's box. */
export function expectWithinHorizontally(el: HTMLElement, container: HTMLElement): void {
  const box = el.getBoundingClientRect()
  const bounds = container.getBoundingClientRect()
  expect(box.left, `"${el.textContent}" overflows left`).toBeGreaterThanOrEqual(bounds.left - 0.5)
  expect(box.right, `"${el.textContent}" overflows right`).toBeLessThanOrEqual(bounds.right + 0.5)
}

/**
 * Asserts a scroll container leaves room for the element's focus ring on all
 * four sides (HON-1353). An `overflow` box clips at its padding edge, and the
 * `Input` and `Button` ring is drawn outside the border. Measured in the
 * container's scroll coordinates, so a control scrolled out of view still
 * counts its distance to the scroll content's top or bottom.
 */
export function expectFocusRingRoom(el: HTMLElement, container: HTMLElement, ring = 3): void {
  const box = el.getBoundingClientRect()
  const bounds = container.getBoundingClientRect()
  const left = bounds.left + container.clientLeft
  const top = bounds.top + container.clientTop - container.scrollTop
  const name =
    el.getAttribute('aria-label') ||
    (el instanceof HTMLInputElement && el.labels?.[0]?.textContent) ||
    el.textContent
  expect(box.left - left, `"${name}" ring clips left`).toBeGreaterThanOrEqual(ring - 0.5)
  expect(
    left + container.clientWidth - box.right,
    `"${name}" ring clips right`,
  ).toBeGreaterThanOrEqual(ring - 0.5)
  expect(box.top - top, `"${name}" ring clips top`).toBeGreaterThanOrEqual(ring - 0.5)
  expect(
    top + container.scrollHeight - box.bottom,
    `"${name}" ring clips bottom`,
  ).toBeGreaterThanOrEqual(ring - 0.5)
}

/**
 * Asserts a meal card's badge row holds one line (HON-1575, HON-1577): every
 * badge on the first badge's top, none past the row's edges. Returns the row,
 * so a story can also check that it overlaps (`data-overlap`).
 */
export function expectBadgeRowOnOneLine(canvasElement: HTMLElement): HTMLElement {
  const badges = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-slot="badge"]'))
  const row = badges[0]!.parentElement!
  const top = Math.round(badges[0]!.getBoundingClientRect().top)
  for (const badge of badges) {
    expect(Math.round(badge.getBoundingClientRect().top), `"${badge.textContent}" wraps`).toBe(top)
    expectWithinHorizontally(badge, row)
  }
  return row
}

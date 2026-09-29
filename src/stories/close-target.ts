import { expect } from 'storybook/test'

/** Close-control geometry, shared by the `Dialog` and `Sheet` stories (HON-810). */

// Layout reports fractional pixels; round to 0.01px so float noise does not
// fail an exact floor.
const px = (value: number) => Math.round(value * 100) / 100

// The close control clears the 32px floor for deliberate sub-44px controls
// (docs/DESIGN.md → Spacing), and its 16px icon stays centred 24px from the
// content's top and right padding edges, within 1px of where it was.
export function assertCloseTarget(content: HTMLElement, close: HTMLElement) {
  const target = close.getBoundingClientRect()
  expect(px(target.width), 'Close width').toBeGreaterThanOrEqual(32)
  expect(px(target.height), 'Close height').toBeGreaterThanOrEqual(32)

  const icon = close.querySelector('svg') as SVGElement
  const glyph = icon.getBoundingClientRect()
  expect(px(glyph.width)).toBe(16)

  const box = content.getBoundingClientRect()
  const border = window.getComputedStyle(content)
  const paddingTop = box.top + Number.parseFloat(border.borderTopWidth)
  const paddingRight = box.right - Number.parseFloat(border.borderRightWidth)
  const centreX = glyph.left + glyph.width / 2
  const centreY = glyph.top + glyph.height / 2
  expect(Math.abs(centreY - paddingTop - 24)).toBeLessThanOrEqual(1)
  expect(Math.abs(paddingRight - centreX - 24)).toBeLessThanOrEqual(1)
}

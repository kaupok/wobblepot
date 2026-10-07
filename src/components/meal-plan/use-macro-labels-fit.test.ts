import { describe, expect, it } from 'vitest'
import { labelsFit } from './use-macro-labels-fit'

describe('labelsFit', () => {
  it('fits when every label is at most as wide as its part', () => {
    expect(labelsFit([120, 80, 180], [60, 80, 40])).toBe(true)
  })

  it('does not fit when one label is wider than its part', () => {
    expect(labelsFit([120, 12, 180], [60, 38, 40])).toBe(false)
  })

  it('allows half a pixel of subpixel slack', () => {
    expect(labelsFit([80], [80.4])).toBe(true)
    expect(labelsFit([80], [80.6])).toBe(false)
  })

  it('reads a part that is not laid out yet as a fit', () => {
    expect(labelsFit([0, 0, 0], [60, 80, 40])).toBe(true)
  })
})

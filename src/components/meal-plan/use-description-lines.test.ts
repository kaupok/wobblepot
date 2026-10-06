import { describe, expect, it } from 'vitest'
import { descriptionLines } from './use-description-lines'

// The desktop text block: two 28px name lines plus two 24px description
// lines (HON-1096). A one-line name sits in its 32px row.
const BLOCK = 104
const LINE = 24

describe('descriptionLines', () => {
  it('gives a one- or two-line name two description lines', () => {
    expect(descriptionLines(BLOCK, 32, LINE)).toBe(2)
    expect(descriptionLines(BLOCK, 56, LINE)).toBe(2)
  })

  it('hides the description under a three-line name: 20px is less than a line', () => {
    expect(descriptionLines(BLOCK, 84, LINE)).toBe(0)
  })

  it('gives the one whole line left', () => {
    expect(descriptionLines(BLOCK, 72, LINE)).toBe(1)
  })

  it('hides the description when the name fills the block or overflows it', () => {
    expect(descriptionLines(BLOCK, 104, LINE)).toBe(0)
    expect(descriptionLines(BLOCK, 140, LINE)).toBe(0)
  })

  it('does not lose a line to a sub-pixel name height', () => {
    expect(descriptionLines(BLOCK, 56.01, LINE)).toBe(2)
    expect(descriptionLines(BLOCK, 80.4, LINE)).toBe(1)
  })

  it('never gives more than two lines', () => {
    expect(descriptionLines(400, 32, LINE)).toBe(2)
  })

  it('keeps two lines when the line height cannot be read', () => {
    expect(descriptionLines(BLOCK, 32, Number.NaN)).toBe(2)
    expect(descriptionLines(BLOCK, 32, 0)).toBe(2)
  })
})

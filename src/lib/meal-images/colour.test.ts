import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  DEFAULT_HUE_OPTIONS,
  extractHue,
  HUE_BASELINE,
  hueFromPixels,
  srgbToOklch,
  winningBin,
} from './colour'

const ORANGE = [230, 140, 40] as const
const GREEN = [60, 160, 60] as const
// Greens either side of the 140° bin edge (OKLCH hue 133 and 147).
const GREEN_133 = [120, 200, 30] as const
const GREEN_147 = [10, 250, 95] as const
// A yellow in the bin after ORANGE's (OKLCH hue 90).
const YELLOW = [220, 185, 85] as const

/** Opaque RGBA pixels: `n` of each colour, in order. */
function pixels(...runs: [readonly [number, number, number], number][]): Uint8Array {
  return new Uint8Array(
    runs.flatMap(([rgb, n]) => Array.from({ length: n }, () => [...rgb, 255]).flat()),
  )
}

/** A 3:2 PNG with a white surface and, optionally, a filled disc in the centre. */
async function plate(disc?: string): Promise<Uint8Array> {
  const circle = disc ? `<circle cx="150" cy="100" r="50" fill="${disc}"/>` : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#fff"/>${circle}</svg>`
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer())
}

describe('srgbToOklch', () => {
  it('converts sRGB primaries to the expected OKLCH hues', () => {
    expect(srgbToOklch(255, 0, 0).h).toBeCloseTo(29, 0)
    expect(srgbToOklch(0, 255, 0).h).toBeCloseTo(142, 0)
    expect(srgbToOklch(0, 0, 255).h).toBeCloseTo(264, 0)
    expect(srgbToOklch(128, 128, 128).C).toBeLessThan(0.001)
    expect(srgbToOklch(255, 255, 255).L).toBeCloseTo(1, 2)
  })
})

describe('hueFromPixels', () => {
  it('votes for the saturated colour and ignores transparent and grey pixels', () => {
    // 4 pixels: transparent red, opaque grey, two opaque blues.
    const data = new Uint8Array([
      255, 0, 0, 0, 128, 128, 128, 255, 0, 0, 255, 255, 10, 10, 250, 255,
    ])
    const result = hueFromPixels(data, 4)
    expect(result.hue).toBeCloseTo(264, -1)
    expect(result.opaque).toBe(0.75)
    expect(result.coverage).toBe(0.5)
  })

  it('reports no hue for an all-grey sample', () => {
    const data = new Uint8Array([200, 200, 200, 255, 40, 40, 40, 255])
    expect(hueFromPixels(data, 4).hue).toBeNull()
  })

  // HON-1009: the most distinctive colour against the baseline, not the most common.
  it('gives a mostly-orange meal with 20% green its green', () => {
    const { hue, bins } = hueFromPixels(pixels([ORANGE, 80], [GREEN, 20]), 4)
    const total = bins.reduce((a, b) => a + b, 0)
    const greenShare = Math.max(...bins.slice(6, 9)) / total
    expect(greenShare).toBeGreaterThanOrEqual(0.15)
    expect(greenShare).toBeLessThan(0.25)
    expect(Math.abs((hue ?? 0) - srgbToOklch(...GREEN).h)).toBeLessThanOrEqual(1)
  })

  it('keeps a meal orange when its green is below the 15% share', () => {
    const { hue } = hueFromPixels(pixels([ORANGE, 95], [GREEN, 5]), 4)
    expect(Math.abs((hue ?? 0) - srgbToOklch(...ORANGE).h)).toBeLessThanOrEqual(1)
  })

  // HON-1014: a colour that lies across a bin edge still passes the share gate.
  it('gives a mostly-orange meal its green when the green is split across a bin edge', () => {
    // 800 orange, 75 + 60 green pixels: about 80% / 10% / 10% of the chroma mass.
    const data = pixels([ORANGE, 800], [GREEN_133, 75], [GREEN_147, 60])
    const { hue, bins } = hueFromPixels(data, 4)
    const total = bins.reduce((a, b) => a + b, 0)
    expect((bins[6] ?? 0) / total).toBeLessThan(0.15)
    expect((bins[7] ?? 0) / total).toBeLessThan(0.15)
    expect(((bins[6] ?? 0) + (bins[7] ?? 0)) / total).toBeGreaterThanOrEqual(0.15)
    expect(hue).toBeGreaterThanOrEqual(120)
    expect(hue).toBeLessThan(160)
    // Judged bin by bin (the HON-1009 rule), neither half qualifies.
    const perBin = hueFromPixels(data, 4, { ...DEFAULT_HUE_OPTIONS, splitEdges: false })
    expect(Math.abs((perBin.hue ?? 0) - srgbToOklch(...ORANGE).h)).toBeLessThanOrEqual(1)
  })

  it('keeps a meal orange when a small accent sits in the next bin', () => {
    // 600 orange, 63 yellow pixels: about 92% / 8% of the chroma mass.
    const { hue, bins } = hueFromPixels(pixels([ORANGE, 600], [YELLOW, 63]), 4)
    const total = bins.reduce((a, b) => a + b, 0)
    expect((bins[4] ?? 0) / total).toBeLessThan(0.1)
    expect(Math.abs((hue ?? 0) - srgbToOklch(...ORANGE).h)).toBeLessThanOrEqual(1)
  })

  it('reproduces the largest-bin rule under a uniform baseline', () => {
    const uniform = { ...DEFAULT_HUE_OPTIONS, baseline: new Array(18).fill(1 / 18) }
    const { hue } = hueFromPixels(pixels([ORANGE, 80], [GREEN, 20]), 4, uniform)
    expect(Math.abs((hue ?? 0) - srgbToOklch(...ORANGE).h)).toBeLessThanOrEqual(1)
  })

  it('rejects a baseline sized for a different number of bins', () => {
    const options = { ...DEFAULT_HUE_OPTIONS, baseline: [1] }
    expect(() => hueFromPixels(pixels([ORANGE, 1]), 4, options)).toThrow('baseline')
  })
})

describe('winningBin', () => {
  const options = { ...DEFAULT_HUE_OPTIONS, baseline: [0.5, 0.1, 0.4], bins: 3 }

  it('picks the eligible bin that most exceeds the baseline', () => {
    // Shares 0.5 / 0.2 / 0.3: scores 1, 2, 0.75.
    expect(winningBin([5, 2, 3], options)).toBe(1)
  })

  it('falls back to the largest bin when none holds the minimum share', () => {
    expect(winningBin([5, 2, 3], { ...options, minShare: 0.6, splitEdges: false })).toBe(0)
  })

  it('floors a near-empty baseline bin so it scores on its share, not on noise', () => {
    const floored = { ...options, baseline: [0.5, 0, 0.5], baselineFloor: 0.5 }
    // Shares 0.4 / 0.2 / 0.4: the empty middle bin divides by 0.5, not 0.
    expect(winningBin([4, 2, 4], floored)).toBe(0)
  })

  it('admits a bin under the minimum share with an adjacent partner no larger than it', () => {
    const orange = new Array(18).fill(0)
    orange[3] = 80
    orange[6] = 10
    orange[7] = 10
    // Bin 7 (140–159°) scores 0.1 / 0.0101 against orange's 0.8 / 0.387.
    expect(winningBin(orange, DEFAULT_HUE_OPTIONS)).toBe(7)
    expect(winningBin(orange, { ...DEFAULT_HUE_OPTIONS, splitEdges: false })).toBe(3)
  })

  it('does not let an accent under 10% win through a bigger neighbour', () => {
    const meal = new Array(18).fill(0)
    meal[3] = 60
    meal[5] = 31
    meal[6] = 9
    // Bin 6 would score 0.09 / 0.0101 against bin 5's 0.31 / 0.0566, but its
    // only partner under it is bin 7 (empty), so it never reaches 15%.
    expect(winningBin(meal, DEFAULT_HUE_OPTIONS)).toBe(5)
  })

  it('gives a split colour the same answer whichever side of the edge holds more', () => {
    // 18% green split across the 120° edge, beside a 12% yellow bin. The
    // larger half must not be blocked by the yellow on its far side.
    const meal = (b5: number, b6: number) => {
      const bins = new Array(18).fill(0)
      bins[2] = 15
      bins[3] = 55
      bins[4] = 12
      bins[5] = b5
      bins[6] = b6
      return bins
    }
    expect(winningBin(meal(10, 8), DEFAULT_HUE_OPTIONS)).toBe(5)
    expect(winningBin(meal(8, 10), DEFAULT_HUE_OPTIONS)).toBe(6)
  })

  it('returns -1 when no bin carries chroma', () => {
    expect(winningBin([0, 0, 0], options)).toBe(-1)
  })

  it('ships one baseline share per bin, summing to about 1', () => {
    expect(HUE_BASELINE).toHaveLength(DEFAULT_HUE_OPTIONS.bins)
    expect(HUE_BASELINE.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2)
  })
})

describe('extractHue', () => {
  it('takes the hue of a saturated blue disc on a white surface', async () => {
    const { hue } = await extractHue(await plate('#0000ff'))
    expect(hue).not.toBeNull()
    expect(Math.abs((hue ?? 0) - 264)).toBeLessThanOrEqual(2)
  })

  it('reports no hue for an all-white image', async () => {
    expect((await extractHue(await plate())).hue).toBeNull()
  })

  it('rejects bytes that are not an image', async () => {
    await expect(extractHue(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })
})

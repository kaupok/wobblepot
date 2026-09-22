import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HUE_OPTIONS,
  hueFromPixels,
  parseArgs,
  renderContactSheet,
  srgbToOklch,
} from './spike-meal-colour'

describe('HON-743: meal colour spike', () => {
  it('converts sRGB primaries to the expected OKLCH hues', () => {
    expect(srgbToOklch(255, 0, 0).h).toBeCloseTo(29, 0)
    expect(srgbToOklch(0, 255, 0).h).toBeCloseTo(142, 0)
    expect(srgbToOklch(0, 0, 255).h).toBeCloseTo(264, 0)
    expect(srgbToOklch(128, 128, 128).C).toBeLessThan(0.001)
    expect(srgbToOklch(255, 255, 255).L).toBeCloseTo(1, 2)
  })

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

  it('parses args and rejects a bad limit', () => {
    expect(parseArgs(['--limit=3', '--source=x'])).toEqual({ limit: 3, source: 'x' })
    expect(() => parseArgs(['--limit=0'])).toThrow('--limit')
    expect(() => parseArgs(['--nope'])).toThrow('Unknown argument')
  })

  it('renders one section per meal with the hue on light and dark cards', () => {
    const hue = { hue: 120, chroma: 0.1, coverage: 0.5, opaque: 1, bins: new Array(18).fill(0) }
    const html = renderContactSheet(
      [
        { slug: 'a', name: 'A & B', preview: 'a.webp', hue },
        { slug: 'b', name: 'B', preview: 'b.webp', hue: { ...hue, hue: 30 } },
      ],
      { startedAt: 'now', options: DEFAULT_HUE_OPTIONS },
    )
    expect(html).toContain('A &amp; B')
    expect(html).toContain('--hue:30')
    // Two meals × (grid light, grid dark, section light, section dark).
    expect(html.match(/class="card (light|dark)"/g)).toHaveLength(8)
  })
})

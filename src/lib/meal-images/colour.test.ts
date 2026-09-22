import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { extractHue, hueFromPixels, srgbToOklch } from './colour'

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

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FOOTPRINT_OPTIONS,
  fitFootprint,
  footprintOfPixels,
  footprintWidth,
  measureFootprint,
  planFit,
  type Footprint,
} from './footprint'

const W = 300
const H = 200

/** A white 3:2 frame with one grey rectangle on it, as a PNG. */
async function frameWith(
  rect: { left: number; top: number; width: number; height: number },
  grey = 120,
): Promise<Uint8Array> {
  const png = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
    .composite([
      {
        input: await sharp({
          create: {
            width: rect.width,
            height: rect.height,
            channels: 3,
            background: { r: grey, g: grey, b: grey },
          },
        })
          .png()
          .toBuffer(),
        left: rect.left,
        top: rect.top,
      },
    ])
    .png()
    .toBuffer()
  return new Uint8Array(png)
}

const fp = (overrides: Partial<Footprint> = {}): Footprint => ({
  left: 60,
  right: 239, // 180 px wide = 0.60 of 300
  top: 50,
  bottom: 149,
  frameWidth: W,
  frameHeight: H,
  ...overrides,
})

describe('HON-1024: footprint measurement', () => {
  it('measures a rectangle on white to the pixel', async () => {
    const bytes = await frameWith({ left: 60, top: 50, width: 180, height: 100 })
    expect(await measureFootprint(bytes)).toEqual({
      left: 60,
      right: 239,
      top: 50,
      bottom: 149,
      frameWidth: W,
      frameHeight: H,
    })
  })

  it('ignores a soft shadow and a stray speck', () => {
    const channels = 3
    const data = new Uint8Array(W * H * channels).fill(255)
    const paint = (x: number, y: number, v: number) => {
      const i = (y * W + x) * channels
      data[i] = data[i + 1] = data[i + 2] = v
    }
    for (let y = 50; y < 150; y++) for (let x = 60; x < 240; x++) paint(x, y, 120)
    // A light shadow one column wider on each side is above the ink threshold.
    for (let y = 140; y < 160; y++) {
      paint(59, y, 230)
      paint(240, y, 230)
    }
    // One dark pixel far away never reaches `minRun` (4 px on this small frame).
    paint(5, 5, 0)
    const options = { inkThreshold: 200, minRun: 0.02 }
    expect(footprintOfPixels(data, { width: W, height: H, channels }, options)).toMatchObject({
      left: 60,
      right: 239,
      top: 50,
      bottom: 149,
    })
  })

  it('returns null for a blank frame', async () => {
    const blank = await sharp({ create: { width: W, height: H, channels: 3, background: '#fff' } })
      .png()
      .toBuffer()
    expect(await measureFootprint(new Uint8Array(blank))).toBeNull()
  })

  it('treats transparent pixels as white', async () => {
    const png = await sharp({
      create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 30, height: 30, channels: 3, background: '#000' },
          })
            .png()
            .toBuffer(),
          left: 100,
          top: 100,
        },
      ])
      .png()
      .toBuffer()
    expect(await measureFootprint(new Uint8Array(png))).toMatchObject({ left: 100, right: 129 })
  })
})

describe('HON-1024: fit plan', () => {
  it('scales a plate to 0.58 and a bowl to 0.50 of the frame width', () => {
    expect(planFit(fp(), 'plate')).toEqual({ action: 'scale', scale: 0.58 / 0.6 })
    expect(planFit(fp(), 'bowl')).toEqual({ action: 'scale', scale: 0.5 / 0.6 })
  })

  it('leaves a glass, a board and an unknown vessel as drawn', () => {
    for (const vessel of ['glass', 'board', 'other'] as const) {
      expect(planFit(fp(), vessel)).toEqual({ action: 'keep', reason: 'no target for the vessel' })
    }
  })

  it('keeps an image that is already within 1% of the target', () => {
    // 174 px = 0.58 exactly; 175 px is 0.6% off.
    expect(planFit(fp({ left: 63, right: 237 }), 'plate')).toEqual({
      action: 'keep',
      reason: 'already at the target width',
    })
  })

  it('skips a blank frame, a cropped vessel and a scale out of range', () => {
    expect(planFit(null, 'plate')).toEqual({ action: 'skip', reason: 'nothing drawn' })
    expect(planFit(fp({ left: 0 }), 'plate')).toEqual({
      action: 'skip',
      reason: 'the footprint touches the frame edge',
    })
    expect(planFit(fp({ bottom: H - 1 }), 'plate')).toEqual({
      action: 'skip',
      reason: 'the footprint touches the frame edge',
    })
    // A 30 px wide footprint would need ×5.8.
    expect(planFit(fp({ left: 100, right: 129 }), 'plate')).toEqual({
      action: 'skip',
      reason: 'scale out of range',
    })
    expect(DEFAULT_FOOTPRINT_OPTIONS.maxScale).toBeLessThan(5.8)
  })
})

describe('HON-1024: fitFootprint', () => {
  it('shrinks a wide plate to the target width, centred, on a white frame of the same size', async () => {
    // 210 px = 0.70, off-centre to the left and the top.
    const bytes = await frameWith({ left: 20, top: 30, width: 210, height: 100 })

    const fitted = await fitFootprint(bytes, 'image/png', 'plate')

    expect(fitted.mediaType).toBe('image/png')
    expect(fitted.fit).toMatchObject({
      vessel: 'plate',
      measuredWidth: 0.7,
      targetWidth: 0.58,
      action: 'scale',
    })
    expect(fitted.fit.scale).toBeCloseTo(0.58 / 0.7)
    const meta = await sharp(fitted.bytes).metadata()
    expect([meta.width, meta.height]).toEqual([W, H])
    const after = await measureFootprint(fitted.bytes)
    expect(after).not.toBeNull()
    expect(footprintWidth(after!)).toBeCloseTo(0.58, 2)
    // Centred on the frame, wherever it was drawn.
    expect((after!.left + after!.right + 1) / 2 / W).toBeCloseTo(0.5, 2)
    expect((after!.top + after!.bottom + 1) / 2 / H).toBeCloseTo(0.5, 2)
    // The padding is white: the corner pixel is untouched.
    const { data } = await sharp(fitted.bytes).raw().toBuffer({ resolveWithObject: true })
    expect([data[0], data[1], data[2]]).toEqual([255, 255, 255])
  })

  it('enlarges a narrow bowl, cutting what overhangs the frame', async () => {
    // 120 px = 0.40 wide, so ×1.25 to reach 0.50; its 180 px height becomes 225 > 200.
    const bytes = await frameWith({ left: 90, top: 10, width: 120, height: 180 })

    const fitted = await fitFootprint(bytes, 'image/png', 'bowl')

    expect(fitted.fit.scale).toBeCloseTo(1.25)
    const meta = await sharp(fitted.bytes).metadata()
    expect([meta.width, meta.height]).toEqual([W, H])
    const after = await measureFootprint(fitted.bytes)
    expect(footprintWidth(after!)).toBeCloseTo(0.5, 2)
    // Taller than the frame now, so it runs edge to edge vertically.
    expect(after).toMatchObject({ top: 0, bottom: H - 1 })
  })

  it('returns the bytes untouched when the image is left as drawn', async () => {
    const bytes = await frameWith({ left: 60, top: 50, width: 180, height: 100 })

    const glass = await fitFootprint(bytes, 'image/png', 'glass')
    expect(glass.bytes).toBe(bytes)
    expect(glass.fit).toEqual({
      vessel: 'glass',
      measuredWidth: 0.6,
      targetWidth: null,
      scale: 1,
      action: 'keep',
      reason: 'no target for the vessel',
    })

    const atEdge = await fitFootprint(
      await frameWith({ left: 0, top: 50, width: 180, height: 100 }),
      'image/jpeg',
      'plate',
    )
    expect(atEdge.mediaType).toBe('image/jpeg')
    expect(atEdge.fit).toMatchObject({
      action: 'skip',
      reason: 'the footprint touches the frame edge',
    })
  })

  it('is idempotent: a fitted image is kept on a second pass', async () => {
    const bytes = await frameWith({ left: 20, top: 30, width: 210, height: 100 })
    const once = await fitFootprint(bytes, 'image/png', 'plate')
    const twice = await fitFootprint(once.bytes, 'image/png', 'plate')
    expect(twice.fit).toMatchObject({ action: 'keep', reason: 'already at the target width' })
    expect(twice.bytes).toBe(once.bytes)
  })
})

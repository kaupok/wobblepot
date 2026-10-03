import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  bowlDepth,
  DEFAULT_FOOTPRINT_OPTIONS,
  elevationDeg,
  fitFootprint,
  footprintClass,
  footprintOfPixels,
  measureFootprint,
  planFit,
  rimWidth,
  type Footprint,
} from './footprint'

const W = 300
const H = 200

type Rect = { left: number; top: number; width: number; height: number }

/** A white 3:2 frame with grey rectangles on it, as a PNG. */
async function frameWith(...rects: Rect[]): Promise<Uint8Array> {
  const png = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
    .composite(
      await Promise.all(
        rects.map(async (rect) => ({
          input: await sharp({
            create: {
              width: rect.width,
              height: rect.height,
              channels: 3,
              background: { r: 120, g: 120, b: 120 },
            },
          })
            .png()
            .toBuffer(),
          left: rect.left,
          top: rect.top,
        })),
      ),
    )
    .png()
    .toBuffer()
  return new Uint8Array(png)
}

/** A 180 px rim (0.60 of 300) on rows 50–149, so the rim row is 100 — the frame's centre line. */
const fp = (overrides: Partial<Footprint> = {}): Footprint => ({
  left: 60,
  right: 239,
  top: 50,
  bottom: 149,
  rimRow: 100,
  rimLeft: 60,
  rimRight: 239,
  frameWidth: W,
  frameHeight: H,
  ...overrides,
})

/** The rim's centre as fractions of the frame. */
const rimCentre = (f: Footprint) => ({
  x: (f.rimLeft + f.rimRight + 1) / 2 / f.frameWidth,
  y: f.rimRow / f.frameHeight,
})

describe('HON-1024: footprint measurement', () => {
  it('measures a rectangle on white to the pixel, with the rim on its middle row', async () => {
    const bytes = await frameWith({ left: 60, top: 50, width: 180, height: 100 })
    expect(await measureFootprint(bytes)).toEqual(fp())
  })

  it('takes the rim from the widest row, not the bounding box', async () => {
    // A tall narrow stack of food on a wide plate: the box is the stack's
    // height, the rim is the plate's row.
    const bytes = await frameWith(
      { left: 120, top: 20, width: 60, height: 100 },
      { left: 60, top: 120, width: 180, height: 20 },
    )
    const f = await measureFootprint(bytes)
    expect(f).toMatchObject({ top: 20, bottom: 139, left: 60, right: 239 })
    expect(f!.rimRow).toBe(130)
    expect([f!.rimLeft, f!.rimRight]).toEqual([60, 239])
    expect(rimWidth(f!)).toBeCloseTo(0.6)
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
      rimLeft: 60,
      rimRight: 239,
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

  it('reads the camera elevation from the rim and the front edge', () => {
    // Half-height 49 over half-width 90: asin(0.544) ≈ 33°.
    expect(elevationDeg(fp())).toBeCloseTo(33, 0)
    // A rim with no height below it is seen from the table.
    expect(elevationDeg(fp({ bottom: 100 }))).toBe(0)
    // Anything deeper than it is wide is seen from straight above.
    expect(elevationDeg(fp({ bottom: 199 }))).toBe(90)
  })
})

describe('HON-1024: bowl depth', () => {
  it('tells a wide bowl from a deep one by what shows below the rim', () => {
    expect(bowlDepth(fp())).toBeCloseTo(49 / 90)
    expect(footprintClass(fp(), 'bowl')).toBe('wide-bowl')
    expect(footprintClass(fp({ bottom: 180 }), 'bowl')).toBe('bowl')
    // Only a bowl is split; a plate's front edge is not a depth.
    expect(footprintClass(fp(), 'plate')).toBe('plate')
    expect(footprintClass(null, 'bowl')).toBe('bowl')
    expect(DEFAULT_FOOTPRINT_OPTIONS.wideBowlDepth).toBe(0.8)
  })
})

describe('HON-1024: fit plan', () => {
  it('scales a plate to 0.58, a wide bowl to 0.50 and a deep bowl to 0.42 of the frame width', () => {
    expect(planFit(fp(), 'plate')).toEqual({ action: 'fit', scale: 0.58 / 0.6 })
    // 49 px below the rim over a 90 px half-width: 0.54, a wide bowl.
    expect(planFit(fp(), 'bowl')).toEqual({ action: 'fit', scale: 0.5 / 0.6 })
    // 80 px below the rim: 0.89, a deep bowl.
    expect(planFit(fp({ bottom: 180 }), 'bowl')).toEqual({ action: 'fit', scale: 0.42 / 0.6 })
  })

  it('leaves a glass, a board and an unknown vessel as drawn', () => {
    for (const vessel of ['glass', 'board', 'other'] as const) {
      expect(planFit(fp(), vessel)).toEqual({ action: 'keep', reason: 'no target for the vessel' })
    }
  })

  it('keeps an image whose rim is within 1% of the target width and on the centre line', () => {
    // 174 px = 0.58 exactly; 175 px is 0.6% off.
    expect(planFit(fp({ left: 63, right: 237, rimLeft: 63, rimRight: 237 }), 'plate')).toEqual({
      action: 'keep',
      reason: 'already fitted',
    })
  })

  it('moves a rim at the right width that sits off the centre line', () => {
    // Right width, but the rim is at 45% of the frame height.
    const off = fp({ left: 63, right: 237, rimLeft: 63, rimRight: 237, rimRow: 90, top: 40 })
    expect(planFit(off, 'plate')).toEqual({ action: 'fit', scale: 0.58 / 0.5833333333333334 })
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
    // A 30 px wide rim would need ×5.8.
    expect(planFit(fp({ left: 100, right: 129, rimLeft: 100, rimRight: 129 }), 'plate')).toEqual({
      action: 'skip',
      reason: 'scale out of range',
    })
    expect(DEFAULT_FOOTPRINT_OPTIONS.maxScale).toBeLessThan(5.8)
  })
})

describe('HON-1024: fitFootprint', () => {
  it('shrinks a wide plate to the target width, its rim on the centre line, on a white frame of the same size', async () => {
    // 210 px = 0.70, off-centre to the left and the top.
    const bytes = await frameWith({ left: 20, top: 30, width: 210, height: 100 })

    const fitted = await fitFootprint(bytes, 'image/png', 'plate')

    expect(fitted.mediaType).toBe('image/png')
    expect(fitted.fit).toMatchObject({
      vessel: 'plate',
      measuredWidth: 0.7,
      targetWidth: 0.58,
      action: 'fit',
    })
    expect(fitted.fit.scale).toBeCloseTo(0.58 / 0.7)
    expect(fitted.fit.elevationDeg).toBeCloseTo(28.1, 0)
    const meta = await sharp(fitted.bytes).metadata()
    expect([meta.width, meta.height]).toEqual([W, H])
    const after = await measureFootprint(fitted.bytes)
    expect(after).not.toBeNull()
    expect(rimWidth(after!)).toBeCloseTo(0.58, 2)
    // The rim's centre on the frame's centre, wherever it was drawn.
    expect(rimCentre(after!).x).toBeCloseTo(0.5, 2)
    expect(rimCentre(after!).y).toBeCloseTo(0.5, 2)
    // The padding is white: the corner pixel is untouched.
    const { data } = await sharp(fitted.bytes).raw().toBuffer({ resolveWithObject: true })
    expect([data[0], data[1], data[2]]).toEqual([255, 255, 255])
  })

  it('anchors a tall dish by its rim, so the food rises above the centre line', async () => {
    // A stack 100 px tall on a 20 px plate: as drawn, the box is centred and the plate sits low.
    const bytes = await frameWith(
      { left: 120, top: 40, width: 60, height: 100 },
      { left: 60, top: 140, width: 180, height: 20 },
    )

    const fitted = await fitFootprint(bytes, 'image/png', 'plate')

    const after = await measureFootprint(fitted.bytes)
    // Within 1% of the frame: a 20 px rim anchors on its middle row, give or take a pixel.
    expect(Math.abs(rimCentre(after!).y - 0.5)).toBeLessThan(0.01)
    expect(after!.top / H).toBeLessThan(0.3)
  })

  it('enlarges a narrow bowl, cutting what overhangs the frame', async () => {
    // 105 px = 0.35 wide, so ×1.2 to reach 0.42; its 180 px height becomes 216 > 200.
    const bytes = await frameWith({ left: 97, top: 10, width: 105, height: 180 })

    const fitted = await fitFootprint(bytes, 'image/png', 'bowl')

    expect(fitted.fit.scale).toBeCloseTo(0.42 / 0.35)
    expect(fitted.fit).toMatchObject({ shape: 'bowl', elevationDeg: null })
    expect(fitted.fit.depth).toBeGreaterThan(1)
    const meta = await sharp(fitted.bytes).metadata()
    expect([meta.width, meta.height]).toEqual([W, H])
    const after = await measureFootprint(fitted.bytes)
    expect(rimWidth(after!)).toBeCloseTo(0.42, 2)
    // Taller than the frame now, so it runs edge to edge vertically.
    expect(after).toMatchObject({ top: 0, bottom: H - 1 })
  })

  it('returns the bytes untouched when the image is left as drawn', async () => {
    const bytes = await frameWith({ left: 60, top: 50, width: 180, height: 100 })

    const glass = await fitFootprint(bytes, 'image/png', 'glass')
    expect(glass.bytes).toBe(bytes)
    expect(glass.fit).toEqual({
      vessel: 'glass',
      shape: 'glass',
      depth: null,
      measuredWidth: 0.6,
      targetWidth: null,
      elevationDeg: null,
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
    expect(twice.fit).toMatchObject({ action: 'keep', reason: 'already fitted' })
    expect(twice.bytes).toBe(once.bytes)
  })
})

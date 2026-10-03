import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  canonicalForEstimate,
  DEFAULT_FOOTPRINT_OPTIONS,
  elevationDeg,
  fitFootprint,
  footprintOfPixels,
  measureFootprint,
  planFit,
  rimWidth,
  targetWidth,
  type Footprint,
} from './footprint'

const W = 300
const H = 200

const dinnerPlate = { vessel: 'plate', diameterCm: 27 } as const
const sidePlate = { vessel: 'plate', diameterCm: 20 } as const
const cerealBowl = { vessel: 'bowl', diameterCm: 15 } as const

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

/** A 180 px rim (0.60 of 300) on rows 50–149, so the rim row and the box's centre are 100 — the frame's centre line. */
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

/** The bounding box's vertical centre in pixels. */
const boxCentreY = (f: Footprint) => (f.top + f.bottom + 1) / 2

/** A stack 100 px tall on a 20 px plate, drawn high: the box's centre is row 80, the rim row 130. */
const tallStack: Rect[] = [
  { left: 120, top: 20, width: 60, height: 100 },
  { left: 60, top: 120, width: 180, height: 20 },
]

/** A 10 px rim on a body 120 px deep: the rim sits near the top of the box. */
const deepBowl: Rect[] = [
  { left: 60, top: 30, width: 180, height: 10 },
  { left: 90, top: 40, width: 120, height: 120 },
]

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

describe('HON-1024: target width', () => {
  it('gives a 27 cm plate 0.58 of the frame and a smaller vessel less, by its diameter to the power 0.7', () => {
    expect(targetWidth(dinnerPlate)).toBeCloseTo(0.58)
    expect(targetWidth(sidePlate)).toBeCloseTo(0.58 * (20 / 27) ** 0.7)
    expect(targetWidth(sidePlate)).toBeCloseTo(0.47, 2)
    expect(targetWidth(cerealBowl)).toBeCloseTo(0.38, 2)
    expect(targetWidth({ vessel: 'bowl', diameterCm: 22 })).toBeCloseTo(0.5, 2)
  })

  it('keeps the width within bounds and leaves a glass, board or anything else as drawn', () => {
    expect(targetWidth({ vessel: 'plate', diameterCm: 40 })).toBe(0.62)
    expect(targetWidth({ vessel: 'bowl', diameterCm: 10 })).toBe(0.33)
    for (const vessel of ['glass', 'board', 'other'] as const) {
      expect(targetWidth({ vessel, diameterCm: 20 })).toBeNull()
    }
  })
})

describe('HON-1024: fit plan', () => {
  it('scales the rim to the width its size calls for', () => {
    expect(planFit(fp(), sidePlate)).toEqual({
      action: 'fit',
      scale: targetWidth(sidePlate)! / 0.6,
    })
    expect(planFit(fp(), { vessel: 'bowl', diameterCm: 22 })).toEqual({
      action: 'fit',
      scale: targetWidth({ vessel: 'bowl', diameterCm: 22 })! / 0.6,
    })
  })

  it('leaves a glass, a board and an unknown vessel as drawn', () => {
    for (const vessel of ['glass', 'board', 'other'] as const) {
      expect(planFit(fp(), { vessel, diameterCm: 20 })).toEqual({
        action: 'keep',
        reason: 'no target for the vessel',
      })
    }
  })

  it('keeps an image whose rim is within 3.5% of the target width and whose box is on the centre line', () => {
    // 174 px = 0.58 exactly; 175 px is 0.6% off and 180 px 3.4%, a 1 cm move of the estimate.
    expect(planFit(fp({ left: 63, right: 237, rimLeft: 63, rimRight: 237 }), dinnerPlate)).toEqual({
      action: 'keep',
      reason: 'already fitted',
    })
    expect(planFit(fp(), dinnerPlate)).toEqual({ action: 'keep', reason: 'already fitted' })
    // 186 px is 6.9% off, a 2 cm move: refit.
    expect(planFit(fp({ left: 57, right: 242, rimLeft: 57, rimRight: 242 }), dinnerPlate)).toEqual({
      action: 'fit',
      scale: 0.58 / 0.62,
    })
  })

  it('moves a drawing at the right width whose box sits off the centre line', () => {
    // Right width, but the box's centre is at 45% of the frame height.
    const off = fp({ left: 63, right: 237, rimLeft: 63, rimRight: 237, top: 40, bottom: 139 })
    expect(planFit(off, dinnerPlate)).toEqual({ action: 'fit', scale: 0.58 / 0.5833333333333334 })
  })

  it('judges the position by the box, not the rim (HON-1031)', () => {
    const rightWidth = { left: 63, right: 237, rimLeft: 63, rimRight: 237 }
    // The rim far below the centre line, the box on it: already fitted.
    expect(planFit(fp({ ...rightWidth, rimRow: 140 }), dinnerPlate)).toEqual({
      action: 'keep',
      reason: 'already fitted',
    })
    // The rim on the centre line, the box 10 px above it: moved.
    expect(planFit(fp({ ...rightWidth, top: 30, bottom: 149 }), dinnerPlate)).toMatchObject({
      action: 'fit',
    })
  })

  it('skips a blank frame, a cropped vessel and a scale out of range', () => {
    expect(planFit(null, dinnerPlate)).toEqual({ action: 'skip', reason: 'nothing drawn' })
    expect(planFit(fp({ left: 0 }), dinnerPlate)).toEqual({
      action: 'skip',
      reason: 'the footprint touches the frame edge',
    })
    expect(planFit(fp({ bottom: H - 1 }), dinnerPlate)).toEqual({
      action: 'skip',
      reason: 'the footprint touches the frame edge',
    })
    // A 30 px wide rim would need ×5.8.
    expect(
      planFit(fp({ left: 100, right: 129, rimLeft: 100, rimRight: 129 }), dinnerPlate),
    ).toEqual({ action: 'skip', reason: 'scale out of range' })
    expect(DEFAULT_FOOTPRINT_OPTIONS.maxScale).toBeLessThan(5.8)
  })
})

describe('HON-1024: canonicalForEstimate', () => {
  it('shows any vessel at the reference width, centred, and passes a blank frame through', async () => {
    const wide = await frameWith({ left: 20, top: 30, width: 210, height: 100 })
    const shown = await canonicalForEstimate(wide, 'image/png')
    const f = await measureFootprint(shown.bytes)
    expect(rimWidth(f!)).toBeCloseTo(0.58, 2)
    expect(rimCentre(f!).x).toBeCloseTo(0.5, 2)
    // A 60 px rim (0.20) needs ×2.9, outside the fit's range but not this one's.
    const small = await frameWith({ left: 120, top: 80, width: 60, height: 40 })
    expect(
      rimWidth((await measureFootprint((await canonicalForEstimate(small, 'image/png')).bytes))!),
    ).toBeCloseTo(0.58, 2)

    const blank = new Uint8Array(
      await sharp({ create: { width: W, height: H, channels: 3, background: '#fff' } })
        .png()
        .toBuffer(),
    )
    expect((await canonicalForEstimate(blank, 'image/png')).bytes).toBe(blank)
  })

  it('keeps the rim, not the box, on the centre line, so the size estimate is unchanged by HON-1031', async () => {
    const shown = await canonicalForEstimate(await frameWith(...tallStack), 'image/png')
    const f = (await measureFootprint(shown.bytes))!
    expect(Math.abs(rimCentre(f).y - 0.5)).toBeLessThan(0.01)
    expect(boxCentreY(f)).toBeLessThan(H / 2 - 10)
  })
})

describe('HON-1024: fitFootprint', () => {
  it('shrinks a wide plate to its width, centred, on a white frame of the same size', async () => {
    // 210 px = 0.70, off-centre to the left and the top.
    const bytes = await frameWith({ left: 20, top: 30, width: 210, height: 100 })

    const fitted = await fitFootprint(bytes, 'image/png', dinnerPlate)

    expect(fitted.mediaType).toBe('image/png')
    expect(fitted.fit).toMatchObject({
      vessel: 'plate',
      diameterCm: 27,
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
    // The rim's centre on the frame's vertical centre line and the box's
    // centre on its horizontal one, wherever it was drawn.
    expect(rimCentre(after!).x).toBeCloseTo(0.5, 2)
    expect(Math.abs(boxCentreY(after!) - H / 2)).toBeLessThanOrEqual(1)
    // The padding is white: the corner pixel is untouched.
    const { data } = await sharp(fitted.bytes).raw().toBuffer({ resolveWithObject: true })
    expect([data[0], data[1], data[2]]).toEqual([255, 255, 255])
  })

  it('draws a side plate narrower than a dinner plate from the same drawing', async () => {
    // 150 px = 0.50: ×1.16 for the dinner plate, ×0.94 for the side plate, both in range.
    const bytes = await frameWith({ left: 50, top: 30, width: 150, height: 100 })

    const dinner = await fitFootprint(bytes, 'image/png', dinnerPlate)
    const side = await fitFootprint(bytes, 'image/png', sidePlate)

    expect(rimWidth((await measureFootprint(dinner.bytes))!)).toBeCloseTo(0.58, 2)
    expect(rimWidth((await measureFootprint(side.bytes))!)).toBeCloseTo(0.47, 2)
  })

  it.each([
    ['a tall stack, its ink far above the rim', tallStack],
    ['a deep bowl, its ink far below the rim', deepBowl],
  ])('centres %s by its box, not its rim (HON-1031)', async (_, rects) => {
    const bytes = await frameWith(...rects)
    for (const estimate of [dinnerPlate, sidePlate]) {
      const fitted = await fitFootprint(bytes, 'image/png', estimate)
      expect(fitted.fit.action).toBe('fit')

      const after = (await measureFootprint(fitted.bytes))!
      expect(Math.abs(boxCentreY(after) - H / 2)).toBeLessThanOrEqual(1)
      expect(rimCentre(after).x).toBeCloseTo(0.5, 2)
      // The rim still sets the scale.
      expect(rimWidth(after)).toBeCloseTo(targetWidth(estimate)!, 2)

      const twice = await fitFootprint(fitted.bytes, 'image/png', estimate)
      expect(twice.fit).toMatchObject({ action: 'keep', reason: 'already fitted' })
    }
  })

  it('enlarges a narrow bowl, cutting what overhangs the frame', async () => {
    // 105 px = 0.35 wide; a 22 cm bowl is 0.50, so ×1.43 would be out of range — a 17 cm one is 0.42, ×1.2.
    const bytes = await frameWith({ left: 97, top: 10, width: 105, height: 180 })
    const bowl = { vessel: 'bowl', diameterCm: 17 } as const

    const fitted = await fitFootprint(bytes, 'image/png', bowl)

    expect(fitted.fit.scale).toBeCloseTo(targetWidth(bowl)! / 0.35)
    expect(fitted.fit).toMatchObject({ vessel: 'bowl', diameterCm: 17, elevationDeg: null })
    const meta = await sharp(fitted.bytes).metadata()
    expect([meta.width, meta.height]).toEqual([W, H])
    const after = await measureFootprint(fitted.bytes)
    expect(rimWidth(after!)).toBeCloseTo(targetWidth(bowl)!, 2)
    // Taller than the frame now, so it runs edge to edge vertically.
    expect(after).toMatchObject({ top: 0, bottom: H - 1 })
  })

  it('returns the bytes untouched when the image is left as drawn', async () => {
    const bytes = await frameWith({ left: 60, top: 50, width: 180, height: 100 })

    const glass = await fitFootprint(bytes, 'image/png', { vessel: 'glass', diameterCm: 8 })
    expect(glass.bytes).toBe(bytes)
    expect(glass.fit).toEqual({
      vessel: 'glass',
      diameterCm: 8,
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
      dinnerPlate,
    )
    expect(atEdge.mediaType).toBe('image/jpeg')
    expect(atEdge.fit).toMatchObject({
      action: 'skip',
      reason: 'the footprint touches the frame edge',
    })
  })

  it('is idempotent: a fitted image is kept on a second pass', async () => {
    const bytes = await frameWith({ left: 20, top: 30, width: 210, height: 100 })
    const once = await fitFootprint(bytes, 'image/png', dinnerPlate)
    const twice = await fitFootprint(once.bytes, 'image/png', dinnerPlate)
    expect(twice.fit).toMatchObject({ action: 'keep', reason: 'already fitted' })
    expect(twice.bytes).toBe(once.bytes)
  })
})

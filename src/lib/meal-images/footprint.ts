import 'server-only'
import sharp from 'sharp'
import type { Vessel, VesselEstimate } from './vessel'

/**
 * Dishware to one scale (HON-1024).
 *
 * The V4 prompt asks for a plate "about half the width of the frame", and the
 * model treats that as a hint: over the first 45 images a plate ran from 0.50
 * to 0.68 of the frame width, so two plates side by side looked different
 * sizes. Scaling every rim to one width fixed that and broke something
 * else: the side plate under a bagel came out as wide as the dinner plate
 * under a shakshuka, and the bagel with it. So the rim is scaled to the
 * vessel's real size, estimated by the vision call in `vessel.ts` from the
 * food on it: a 27 cm dinner plate is 0.58 of the frame, and a smaller
 * vessel narrower by its diameter to the power 0.7. True scale (power 1)
 * made a 15 cm cereal bowl 0.32 of the frame, too small on a card; power
 * 0.7 keeps the plate, side plate and bowl in order at 0.58, 0.50 and 0.40.
 *
 * The surface is pure white by design (HON-744), so the image can be
 * rescaled about the vessel's rim and padded with white after generation,
 * with no seam. The rim sets the scale and the horizontal centre: the
 * widest row of ink is the rim's horizontal diameter. The vertical centre
 * is the drawing's bounding box, placed on the frame's centre line
 * (HON-1031). The rim on that line kept one table level across dishes, but
 * each card has its own image box, so a tall stack sat high in its card and
 * a deep bowl, whose widest row is near its top, hung below the centre.
 *
 * The camera's elevation is measured from the rim's front half-ellipse and
 * reported, not corrected: the model picks it per dish (a sandwich is drawn
 * from lower down, to show its layers), an explicit angle in the prompt did
 * not narrow it, and a squash of the pixels would distort the food.
 *
 * Measured on the stored bytes, so the lazy route, the operator batch and the
 * backfill all produce the same result from the same image.
 */

export interface FootprintScale {
  /** The vessel every other is sized against: a dinner plate. */
  referenceCm: number
  /** Its rim width as a fraction of the frame width. */
  referenceWidth: number
  /** How fast the width falls with the diameter: 1 is true scale, 0 is one size. */
  exponent: number
  /** Bounds for the width, whatever the estimate. */
  minWidth: number
  maxWidth: number
}

export interface FootprintOptions {
  /**
   * A pixel whose darkest channel is below this is the vessel or the food.
   * The surface is white and its shadow is a soft light grey, so 200 keeps
   * the shadow out and a cream plate rim in (a rim measured 0.42 at 160 and
   * 0.58 at 200 on one image).
   */
  inkThreshold: number
  /**
   * A row or column needs this many ink pixels to set an edge, as a fraction
   * of the frame's shorter side, so a stray speck never widens the footprint.
   */
  minRun: number
  scale: FootprintScale
  /** The vessels that are fitted; any other is left as drawn. */
  fitted: readonly Vessel[]
  /** Where the vertical anchor sits, as a fraction of the frame height. */
  anchorY: number
  /**
   * What is placed at `anchorY`: the centre of the drawing's bounding box,
   * or the rim's row. The fit uses the box (HON-1031); the view for the
   * vision call keeps the rim, so its size estimate is unchanged.
   */
  anchor: 'box' | 'rim'
  /**
   * A scale outside this range says the footprint is not the vessel: a rim
   * too pale to count would measure only the food and ask for ×1.4 or more.
   * The 45 measured images needed ×0.86 to ×1.17. The image is left as drawn.
   */
  minScale: number
  maxScale: number
  /**
   * A scale this close to 1 is not worth a resample. Wide enough to absorb
   * the size estimate moving by a centimetre between two runs (3.2% of the
   * width at 22 cm), so a refit rerun does not re-upload a third of the
   * images for nothing; a 2 cm move still refits.
   */
  tolerance: number
  /** A drawing this close to its anchor, as a fraction of the frame, is not worth a move. */
  positionTolerance: number
}

/**
 * 0.58 for a 27 cm plate: the median of the 36 plates (0.59) measured on
 * 2026-10-03, rounded towards the prompt's "about half". The bounds cover
 * a 12 cm ramekin and a 32 cm pizza plate. Changing any of this changes
 * every stored image, through the backfill in docs/DEPLOYMENT.md § "Meal
 * footprint backfill".
 */
export const FOOTPRINT_SCALE: FootprintScale = {
  referenceCm: 27,
  referenceWidth: 0.58,
  exponent: 0.7,
  minWidth: 0.33,
  maxWidth: 0.62,
}

export const DEFAULT_FOOTPRINT_OPTIONS: FootprintOptions = {
  inkThreshold: 200,
  minRun: 0.005,
  scale: FOOTPRINT_SCALE,
  fitted: ['plate', 'bowl'],
  anchorY: 0.5,
  anchor: 'box',
  minScale: 0.7,
  maxScale: 1.2,
  tolerance: 0.035,
  positionTolerance: 0.005,
}

/** The rim width a vessel of this size gets, as a fraction of the frame width; null for a vessel left as drawn. */
export function targetWidth(
  estimate: VesselEstimate,
  options: Pick<FootprintOptions, 'scale' | 'fitted'> = DEFAULT_FOOTPRINT_OPTIONS,
): number | null {
  if (!options.fitted.includes(estimate.vessel)) return null
  const { referenceCm, referenceWidth, exponent, minWidth, maxWidth } = options.scale
  const width = referenceWidth * (estimate.diameterCm / referenceCm) ** exponent
  return Math.min(maxWidth, Math.max(minWidth, width))
}

/**
 * The image as the vision call should see it: the rim scaled to the
 * reference width and centred, whatever the vessel. The model's size estimate
 * leans on how big the vessel looks in the frame as well as on the food, so
 * an image estimated after a fit came back a few centimetres different from
 * the same drawing before it, and a refit rerun moved a third of the images
 * by a few percent. Shown every vessel at one width, it has only the food to
 * go on, and the estimate no longer depends on what the fit did last time.
 * Falls back to the image as given when there is nothing to measure.
 */
export async function canonicalForEstimate(
  bytes: Uint8Array,
  mediaType: string,
  options: FootprintOptions = DEFAULT_FOOTPRINT_OPTIONS,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const reference = { vessel: 'plate', diameterCm: options.scale.referenceCm } as const
  const fitted = await fitFootprint(bytes, mediaType, reference, {
    ...options,
    // The rim on the centre line, as in HON-1024: the view only feeds the
    // size estimate, and an unchanged view keeps the estimate unchanged.
    anchor: 'rim',
    // Any width is canonical here, so a cropped or odd drawing is still sent.
    minScale: 0.25,
    maxScale: 4,
    tolerance: 0,
  })
  return { bytes: fitted.bytes, mediaType: fitted.mediaType }
}

/** The vessel and its food in pixels, edges inclusive. */
export interface Footprint {
  /** The bounding box of all ink. */
  left: number
  right: number
  top: number
  bottom: number
  /** The widest row of ink: the rim's horizontal diameter. */
  rimRow: number
  rimLeft: number
  rimRight: number
  frameWidth: number
  frameHeight: number
}

/** The bounding box's width as a fraction of the frame width. */
export const footprintWidth = (fp: Footprint): number => (fp.right - fp.left + 1) / fp.frameWidth

/** The rim's width as a fraction of the frame width: what the targets are set in. */
export const rimWidth = (fp: Footprint): number => (fp.rimRight - fp.rimLeft + 1) / fp.frameWidth

/**
 * The camera's elevation above the table, in degrees, from the rim's front
 * half-ellipse: its half-height (rim row to the lowest ink) over its
 * half-width. Only meaningful for a plate, whose lowest ink is the rim's
 * front edge; a bowl's lowest ink is its base. The 34 plates measured on
 * 2026-10-03 ran from 32° to 44°.
 */
export function elevationDeg(fp: Footprint): number {
  const halfWidth = (fp.rimRight - fp.rimLeft + 1) / 2
  const halfHeight = fp.bottom - fp.rimRow
  if (halfWidth <= 0) return 0
  return (Math.asin(Math.min(1, Math.max(0, halfHeight / halfWidth))) * 180) / Math.PI
}

/**
 * Find the footprint from the raw pixels: the first and last column and row
 * with at least `minRun` ink pixels, and the widest row. `null` when nothing
 * is dark enough.
 */
export function footprintOfPixels(
  data: Uint8Array,
  frame: { width: number; height: number; channels: number },
  options: Pick<FootprintOptions, 'inkThreshold' | 'minRun'> = DEFAULT_FOOTPRINT_OPTIONS,
): Footprint | null {
  const { width, height, channels } = frame
  const cols = new Uint32Array(width)
  const rows = new Uint32Array(height)
  const rowLeft = new Int32Array(height).fill(-1)
  const rowRight = new Int32Array(height).fill(-1)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      const darkest = Math.min(data[i]!, data[i + 1]!, data[i + 2]!)
      if (darkest < options.inkThreshold) {
        cols[x]!++
        rows[y]!++
        if (rowLeft[y] === -1) rowLeft[y] = x
        rowRight[y] = x
      }
    }
  }
  const minRun = Math.max(1, Math.round(options.minRun * Math.min(width, height)))
  const first = (counts: Uint32Array) => counts.findIndex((c) => c >= minRun)
  // Not `findLastIndex`: the project's TypeScript lib is ES2022.
  const last = (counts: Uint32Array) => {
    for (let i = counts.length - 1; i >= 0; i--) if (counts[i]! >= minRun) return i
    return -1
  }
  const left = first(cols)
  if (left === -1) return null
  const top = first(rows)
  if (top === -1) return null

  // The rim row: the median of the rows within 1.5% of the widest span, so a
  // rim drawn a few pixels thick anchors on its middle, not its top edge.
  const span = (y: number) => (rows[y]! >= minRun ? rowRight[y]! - rowLeft[y]! + 1 : 0)
  let widest = 0
  for (let y = 0; y < height; y++) widest = Math.max(widest, span(y))
  const wideRows: number[] = []
  for (let y = 0; y < height; y++) if (span(y) >= 0.985 * widest) wideRows.push(y)
  const rimRow = wideRows[Math.floor(wideRows.length / 2)]!

  return {
    left,
    right: last(cols),
    top,
    bottom: last(rows),
    rimRow,
    rimLeft: rowLeft[rimRow]!,
    rimRight: rowRight[rimRow]!,
    frameWidth: width,
    frameHeight: height,
  }
}

/** Decode the image and find its footprint. Transparent pixels count as white. */
export async function measureFootprint(
  bytes: Uint8Array,
  options: FootprintOptions = DEFAULT_FOOTPRINT_OPTIONS,
): Promise<Footprint | null> {
  const { data, info } = await sharp(bytes)
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return footprintOfPixels(
    data,
    { width: info.width, height: info.height, channels: info.channels },
    options,
  )
}

export type FitDecision =
  | { action: 'fit'; scale: number }
  | { action: 'keep'; reason: 'no target for the vessel' | 'already fitted' }
  | {
      action: 'skip'
      reason: 'nothing drawn' | 'the footprint touches the frame edge' | 'scale out of range'
    }

/**
 * How far to move the image after `scale`, in pixels: the rim's centre to the
 * frame's centre horizontally, so a side item does not push the plate aside,
 * and the anchor to `anchorY` vertically.
 */
function anchorOffset(fp: Footprint, scale: number, options: FootprintOptions) {
  const cx = (fp.rimLeft + fp.rimRight + 1) / 2
  const cy = options.anchor === 'rim' ? fp.rimRow : (fp.top + fp.bottom + 1) / 2
  const dx = fp.frameWidth / 2 - cx * scale
  const dy = fp.frameHeight * options.anchorY - cy * scale
  return { dx, dy }
}

/** What to do with an image, from its footprint and the vessel estimate. Pure, so it is unit-tested on numbers. */
export function planFit(
  footprint: Footprint | null,
  estimate: VesselEstimate,
  options: FootprintOptions = DEFAULT_FOOTPRINT_OPTIONS,
): FitDecision {
  const target = targetWidth(estimate, options)
  if (target === null) return { action: 'keep', reason: 'no target for the vessel' }
  if (!footprint) return { action: 'skip', reason: 'nothing drawn' }
  if (
    footprint.left === 0 ||
    footprint.top === 0 ||
    footprint.right === footprint.frameWidth - 1 ||
    footprint.bottom === footprint.frameHeight - 1
  ) {
    // A cropped vessel has no measurable width; scaling it would guess.
    return { action: 'skip', reason: 'the footprint touches the frame edge' }
  }
  const scale = target / rimWidth(footprint)
  if (scale < options.minScale || scale > options.maxScale) {
    return { action: 'skip', reason: 'scale out of range' }
  }
  // "Already fitted" is judged as drawn: a drawing at the anchor would still
  // move by its centre times (1 - scale) if the near-1 scale were applied.
  const { dx, dy } = anchorOffset(footprint, 1, options)
  if (
    Math.abs(scale - 1) <= options.tolerance &&
    Math.abs(dx) <= options.positionTolerance * footprint.frameWidth &&
    Math.abs(dy) <= options.positionTolerance * footprint.frameHeight
  ) {
    return { action: 'keep', reason: 'already fitted' }
  }
  return { action: 'fit', scale }
}

/** What `fitFootprint` did to an image, stored on the batch manifest and logged by the route. */
export interface FootprintFit {
  vessel: Vessel
  /** The rim's diameter in life, as the vision call estimated it from the food. */
  diameterCm: number
  /** The rim as drawn, as a fraction of the frame width; null when nothing was drawn. */
  measuredWidth: number | null
  targetWidth: number | null
  /** The camera's elevation in degrees, for a plate; null for any other vessel or nothing drawn. */
  elevationDeg: number | null
  /** The scale applied; 1 when the image was left as drawn. */
  scale: number
  action: FitDecision['action']
  /** Why the image was left as drawn. */
  reason?: string
}

export interface FittedImage {
  bytes: Uint8Array
  mediaType: string
  fit: FootprintFit
}

/**
 * Scale the image about its rim so the rim is the width its vessel's size
 * calls for, and centre the drawing in the frame: the rim's centre
 * horizontally, the bounding box's centre vertically, on a white canvas of
 * the original size. The result is a PNG whatever came in.
 * An image that is left as drawn comes back as it was, bytes and media type
 * both.
 */
export async function fitFootprint(
  bytes: Uint8Array,
  mediaType: string,
  estimate: VesselEstimate,
  options: FootprintOptions = DEFAULT_FOOTPRINT_OPTIONS,
): Promise<FittedImage> {
  const footprint = await measureFootprint(bytes, options)
  const decision = planFit(footprint, estimate, options)
  const { vessel, diameterCm } = estimate
  const measuredWidth = footprint ? rimWidth(footprint) : null
  const target = targetWidth(estimate, options)
  const elevation =
    footprint && vessel === 'plate' ? Math.round(elevationDeg(footprint) * 10) / 10 : null

  if (decision.action !== 'fit' || !footprint) {
    return {
      bytes,
      mediaType,
      fit: {
        vessel,
        diameterCm,
        measuredWidth,
        targetWidth: target,
        elevationDeg: elevation,
        scale: 1,
        action: decision.action,
        ...(decision.action !== 'fit' && { reason: decision.reason }),
      },
    }
  }

  const { scale } = decision
  const { frameWidth: W, frameHeight: H } = footprint
  const scaledW = Math.max(1, Math.round(W * scale))
  const scaledH = Math.max(1, Math.round(H * scale))
  const { dx, dy } = anchorOffset(footprint, scale, options)
  const left = Math.round(dx)
  const top = Math.round(dy)

  // The part of the scaled image that lands inside the frame: an enlarged
  // image overhangs the frame on the sides, so it is cut to fit first.
  const x0 = Math.max(0, -left)
  const y0 = Math.max(0, -top)
  const x1 = Math.min(scaledW, W - left)
  const y1 = Math.min(scaledH, H - top)
  const piece = await sharp(bytes)
    .flatten({ background: '#ffffff' })
    .resize(scaledW, scaledH, { kernel: 'lanczos3', fit: 'fill' })
    .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .png()
    .toBuffer()
  const out = await sharp({
    create: { width: W, height: H, channels: 3, background: '#ffffff' },
  })
    .composite([{ input: piece, left: Math.max(0, left), top: Math.max(0, top) }])
    .png()
    .toBuffer()

  return {
    bytes: new Uint8Array(out),
    mediaType: 'image/png',
    fit: {
      vessel,
      diameterCm,
      measuredWidth,
      targetWidth: target,
      elevationDeg: elevation,
      scale,
      action: 'fit',
    },
  }
}

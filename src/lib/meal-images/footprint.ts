import 'server-only'
import sharp from 'sharp'
import type { Vessel } from './vessel'

/**
 * One footprint per vessel (HON-1024).
 *
 * The V4 prompt asks for a plate "about half the width of the frame", and the
 * model treats that as a hint: over the first 45 images a plate ran from 0.50
 * to 0.68 of the frame width, a bowl from 0.46 to 0.55, so two plates side by
 * side looked different sizes. The surface is pure white by design (HON-744),
 * so the image can be rescaled about the vessel's rim and padded with white
 * after generation, with no seam. A bowl stays narrower than a plate, as in
 * life: the same vessel gets the same width, not every vessel.
 *
 * The rim is the anchor, not the drawing's bounding box: the widest row of
 * ink is the rim's horizontal diameter, and it is placed on the frame's
 * centre line, so a tall stack of pancakes rises from the same table level
 * as a flat omelette instead of pushing its plate down the frame.
 *
 * The camera's elevation is measured from the rim's front half-ellipse and
 * reported, not corrected: the model picks it per dish (a sandwich is drawn
 * from lower down, to show its layers), an explicit angle in the prompt did
 * not narrow it, and a squash of the pixels would distort the food.
 *
 * Measured on the stored bytes, so the lazy route, the operator batch and the
 * backfill all produce the same result from the same image.
 */

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
  /** Width of the rim per vessel, as a fraction of the frame width; null leaves the image as drawn. */
  targets: Record<Vessel, number | null>
  /** Where the rim's horizontal diameter sits, as a fraction of the frame height. */
  anchorY: number
  /**
   * A scale outside this range says the footprint is not the vessel: a rim
   * too pale to count would measure only the food and ask for ×1.4 or more.
   * The 45 measured images needed ×0.86 to ×1.17. The image is left as drawn.
   */
  minScale: number
  maxScale: number
  /** A scale this close to 1 is not worth a resample. */
  tolerance: number
  /** A rim this close to its anchor, as a fraction of the frame, is not worth a move. */
  positionTolerance: number
}

/**
 * Plate 0.58: the median of the 36 plates (0.59) measured on 2026-10-03,
 * rounded towards the prompt's "about half". Bowl 0.42: the bowls' own
 * median (0.51) made a bowl read as a large portion beside a plate; at 0.42
 * it reads as a bowl, and 0.46 still looked big. Changing a target changes
 * every stored image, through the backfill in docs/DEPLOYMENT.md § "Meal
 * footprint backfill".
 */
export const FOOTPRINT_TARGETS: Record<Vessel, number | null> = {
  plate: 0.58,
  bowl: 0.42,
  glass: null,
  board: null,
  other: null,
}

export const DEFAULT_FOOTPRINT_OPTIONS: FootprintOptions = {
  inkThreshold: 200,
  minRun: 0.005,
  targets: FOOTPRINT_TARGETS,
  anchorY: 0.5,
  minScale: 0.7,
  maxScale: 1.2,
  tolerance: 0.01,
  positionTolerance: 0.005,
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

/** Where the rim's centre lands after `scale`, and where it should be, in pixels. */
function rimOffset(fp: Footprint, scale: number, options: FootprintOptions) {
  const cx = (fp.rimLeft + fp.rimRight + 1) / 2
  const dx = fp.frameWidth / 2 - cx * scale
  const dy = fp.frameHeight * options.anchorY - fp.rimRow * scale
  return { dx, dy }
}

/** What to do with an image, from its footprint and vessel. Pure, so it is unit-tested on numbers. */
export function planFit(
  footprint: Footprint | null,
  vessel: Vessel,
  options: FootprintOptions = DEFAULT_FOOTPRINT_OPTIONS,
): FitDecision {
  const target = options.targets[vessel]
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
  const { dx, dy } = rimOffset(footprint, scale, options)
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
 * Scale the image about its rim so the rim is the vessel's target width, and
 * place the rim's centre on the frame's centre line, on a white canvas of
 * the original size. The result is a PNG whatever came in. An image that is
 * left as drawn comes back as it was, bytes and media type both.
 */
export async function fitFootprint(
  bytes: Uint8Array,
  mediaType: string,
  vessel: Vessel,
  options: FootprintOptions = DEFAULT_FOOTPRINT_OPTIONS,
): Promise<FittedImage> {
  const footprint = await measureFootprint(bytes, options)
  const decision = planFit(footprint, vessel, options)
  const measuredWidth = footprint ? rimWidth(footprint) : null
  const targetWidth = options.targets[vessel]
  const elevation =
    footprint && vessel === 'plate' ? Math.round(elevationDeg(footprint) * 10) / 10 : null

  if (decision.action !== 'fit' || !footprint) {
    return {
      bytes,
      mediaType,
      fit: {
        vessel,
        measuredWidth,
        targetWidth,
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
  const { dx, dy } = rimOffset(footprint, scale, options)
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
    fit: { vessel, measuredWidth, targetWidth, elevationDeg: elevation, scale, action: 'fit' },
  }
}

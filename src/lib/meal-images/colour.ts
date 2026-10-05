import 'server-only'
import sharp from 'sharp'

/**
 * A meal's colour, taken from its illustration (HON-743 decision, HON-744).
 *
 * The naive dominant colour of a plated dish is the plate or the surface, so
 * the rule crops to the centre, drops grey pixels below a chroma floor, and
 * sorts the rest into 18 hue bins weighted by chroma. The winner is the bin
 * the meal owns most against `HUE_BASELINE`, not the biggest one (HON-1009):
 * cooked food under a warm gouache palette is mostly orange, so the biggest
 * bin gave almost every meal the same amber card. A colour that lies across a
 * bin edge passes the share gate through its window (HON-1014), so a green
 * split 10/10 between two bins is not lost as two halves under 15%. The hue
 * is extracted once, when the image is stored, onto `Meal.imageHue`; the card
 * tints itself with `oklch(L C hue)` from fixed tokens, so hue is the only
 * per-meal variable.
 *
 * Moved unchanged from `scripts/spike-meal-colour.ts`, except that
 * `extractHue` takes bytes: the route and the batch publish both hold them.
 */

export interface Oklch {
  L: number
  C: number
  h: number
}

/** sRGB 0–255 to OKLCH (Björn Ottosson's OKLab, hue in degrees 0–360). */
export function srgbToOklch(r8: number, g8: number, b8: number): Oklch {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const r = lin(r8)
  const g = lin(g8)
  const b = lin(b8)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.hypot(a, bb)
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360
  return { L, C, h }
}

/**
 * The mean share of chroma mass per hue bin over every stored meal image, so
 * a meal's bins can be scored against what a typical meal looks like. Bin `b`
 * covers hues `b * 20` to `b * 20 + 20` degrees. A constant, not a live query:
 * a hue is extracted once per image and must not change because other meals
 * were added.
 *
 * Produced on 2026-10-03 by `pnpm meal-images:rehue --baseline` from the 25
 * distinct images in a staging-fork database. They are almost all warm, so
 * most of bins 7–17 (140–360°) read 0 and fall to `baselineFloor`. Regenerate
 * it when the image style changes (a new prompt version or HON-971), then
 * backfill: docs/DEPLOYMENT.md § "Meal hue backfill".
 */
export const HUE_BASELINE: readonly number[] = [
  0.0074, 0.1396, 0.2633, 0.387, 0.1266, 0.0566, 0.0101, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
  0.0, 0.0027, 0.0067,
]

export interface HueOptions {
  /** Fraction of width and height kept around the centre before sampling. */
  cropFraction: number
  /** Sampling resolution after the crop. */
  size: number
  /** Pixels below this chroma are grey, plate or table and carry no hue. */
  chromaFloor: number
  /** Number of hue bins the vote is taken over. */
  bins: number
  /** Pixels with alpha below this are background in a transparent image. */
  alphaFloor: number
  /**
   * A bin can win only with at least this share of the meal's chroma mass,
   * so a garnish or a spoon of sauce does not take over the card.
   */
  minShare: number
  /**
   * Lower bound on a baseline share before it divides, so a bin almost no
   * meal uses cannot win on noise.
   */
  baselineFloor: number
  /** Expected share per bin, one entry per bin: see `HUE_BASELINE`. */
  baseline: readonly number[]
  /**
   * Bins on each side that make up a bin's window. A bin under `minShare` is
   * still eligible when its window holds `minShare` and it is the window's
   * peak, so a colour split 10/10 across a bin edge counts. It scores on its
   * own share, as every bin does. 0 judges each bin alone (the HON-1009 rule).
   */
  window: number
}

export const DEFAULT_HUE_OPTIONS: HueOptions = {
  cropFraction: 0.6,
  size: 64,
  // 0.04 lets the cream plate and the painted tabletop vote; they outnumber
  // the food. 0.08 keeps sauces, yolks, greens and meat.
  chromaFloor: 0.08,
  bins: 18,
  alphaFloor: 128,
  minShare: 0.15,
  baselineFloor: 0.01,
  baseline: HUE_BASELINE,
  window: 1,
}

export interface HueResult {
  /** Winning hue in degrees, or null when nothing in the sample carries chroma. */
  hue: number | null
  /** Chroma of the winning bin, averaged: how strongly the meal owns that hue. */
  chroma: number
  /** Share of sampled pixels that voted (opaque and above the chroma floor). */
  coverage: number
  /** Share of sampled pixels that were opaque at all. */
  opaque: number
  /** Chroma mass per bin, for the sheet's histogram. */
  bins: number[]
}

/** The bins `window` either side of `centre`, wrapping round the hue circle. */
function windowBins(centre: number, options: Pick<HueOptions, 'bins' | 'window'>): number[] {
  const out: number[] = []
  for (let d = -options.window; d <= options.window; d++) {
    out.push((((centre + d) % options.bins) + options.bins) % options.bins)
  }
  return out
}

/**
 * The winning bin: among eligible bins, the one whose share most exceeds the
 * baseline's. A bin is eligible with at least `minShare` of the chroma mass on
 * its own, or with `minShare` across its window when it is the window's peak:
 * a colour split 10/10 across a bin edge then still counts, through its larger
 * half, while a small accent beside a big bin never peaks and stays out. With
 * no eligible bin, the largest. -1 when there is no chroma at all.
 */
export function winningBin(bins: ArrayLike<number>, options: HueOptions): number {
  let sum = 0
  for (let b = 0; b < bins.length; b++) sum += bins[b] ?? 0
  if (sum === 0) return -1
  let largest = 0
  let distinctive = -1
  let best = -Infinity
  for (let b = 0; b < bins.length; b++) {
    const mass = bins[b] ?? 0
    const share = mass / sum
    if (mass > (bins[largest] ?? 0)) largest = b
    if (share < options.minShare) {
      let windowMass = 0
      let peak = true
      for (const w of windowBins(b, { bins: bins.length, window: options.window })) {
        windowMass += bins[w] ?? 0
        if ((bins[w] ?? 0) > mass) peak = false
      }
      if (!peak || windowMass / sum < options.minShare) continue
    }
    const score = share / Math.max(options.baseline[b] ?? 0, options.baselineFloor)
    if (score > best) {
      best = score
      distinctive = b
    }
  }
  return distinctive === -1 ? largest : distinctive
}

/** Vote over RGBA pixels: hue bins weighted by chroma, circular mean of the winner. */
export function hueFromPixels(
  data: Uint8Array,
  channels: number,
  options: HueOptions = DEFAULT_HUE_OPTIONS,
): HueResult {
  if (options.baseline.length !== options.bins) {
    throw new Error(
      `The hue baseline has ${options.baseline.length} bins, the options ${options.bins}`,
    )
  }
  if (
    !Number.isInteger(options.window) ||
    options.window < 0 ||
    2 * options.window + 1 > options.bins
  ) {
    throw new Error(`A hue window of ${options.window} does not fit ${options.bins} bins`)
  }
  // Typed arrays index without `undefined` under noUncheckedIndexedAccess.
  const bins = new Float64Array(options.bins)
  const sin = new Float64Array(options.bins)
  const cos = new Float64Array(options.bins)
  const count = new Uint32Array(options.bins)
  const total = Math.floor(data.length / channels)
  let opaque = 0
  let voted = 0
  for (let i = 0; i < total; i++) {
    const o = i * channels
    const alpha = channels >= 4 ? (data[o + 3] ?? 0) : 255
    if (alpha < options.alphaFloor) continue
    opaque++
    const { C, h } = srgbToOklch(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0)
    if (C < options.chromaFloor) continue
    voted++
    const bin = Math.min(options.bins - 1, Math.floor((h / 360) * options.bins))
    const rad = (h * Math.PI) / 180
    bins[bin] = (bins[bin] ?? 0) + C
    sin[bin] = (sin[bin] ?? 0) + Math.sin(rad) * C
    cos[bin] = (cos[bin] ?? 0) + Math.cos(rad) * C
    count[bin] = (count[bin] ?? 0) + 1
  }
  const winner = winningBin(bins, options)
  if (winner === -1) {
    return {
      hue: null,
      chroma: 0,
      coverage: 0,
      opaque: total ? opaque / total : 0,
      bins: Array.from(bins),
    }
  }
  const hue = ((Math.atan2(sin[winner] ?? 0, cos[winner] ?? 0) * 180) / Math.PI + 360) % 360
  return {
    hue: Math.round(hue),
    chroma: (bins[winner] ?? 0) / (count[winner] ?? 1),
    coverage: total ? voted / total : 0,
    opaque: total ? opaque / total : 0,
    bins: Array.from(bins),
  }
}

/** Crop the centre of an encoded image, sample it, and take the vote. */
export async function extractHue(
  bytes: Uint8Array,
  options: HueOptions = DEFAULT_HUE_OPTIONS,
): Promise<HueResult> {
  const image = sharp(bytes)
  const meta = await image.metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const w = Math.round(width * options.cropFraction)
  const h = Math.round(height * options.cropFraction)
  const { data, info } = await image
    .extract({
      left: Math.round((width - w) / 2),
      top: Math.round((height - h) / 2),
      width: w,
      height: h,
    })
    .resize(options.size, options.size, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return hueFromPixels(new Uint8Array(data), info.channels, options)
}

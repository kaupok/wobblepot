import 'server-only'
import sharp from 'sharp'

/**
 * A meal's colour, taken from its illustration (HON-743 decision, HON-744).
 *
 * The naive dominant colour of a plated dish is the plate or the surface, so
 * the rule crops to the centre, drops grey pixels below a chroma floor, and
 * takes the chroma-weighted winner of 18 hue bins. The hue is extracted once,
 * when the image is stored, onto `Meal.imageHue`; the card tints itself with
 * `oklch(L C hue)` from fixed tokens, so hue is the only per-meal variable.
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
}

export const DEFAULT_HUE_OPTIONS: HueOptions = {
  cropFraction: 0.6,
  size: 64,
  // 0.04 lets the cream plate and the painted tabletop vote; they outnumber
  // the food. 0.08 keeps sauces, yolks, greens and meat.
  chromaFloor: 0.08,
  bins: 18,
  alphaFloor: 128,
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

/** Vote over RGBA pixels: hue bins weighted by chroma, circular mean of the winner. */
export function hueFromPixels(
  data: Uint8Array,
  channels: number,
  options: HueOptions = DEFAULT_HUE_OPTIONS,
): HueResult {
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
  let winner = 0
  for (let b = 1; b < options.bins; b++) if ((bins[b] ?? 0) > (bins[winner] ?? 0)) winner = b
  if (bins[winner] === 0) {
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

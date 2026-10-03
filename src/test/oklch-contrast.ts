import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Contrast measured straight from the tokens in globals.css, for the tests
 * that hold a token pairing to a WCAG floor (`src/lib/meal-tint.test.ts`,
 * `src/components/ui/checkbox-contrast.test.ts`). axe in Storybook sees only
 * the pairings a story renders; these measure the tokens themselves.
 */

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/** The body of a top-level rule, such as `:root` or `.dark`. */
export function block(selector: string): string {
  const match = css.match(new RegExp(`\\n${selector.replace('.', '\\.')} \\{([^}]*)\\}`))
  if (!match?.[1]) throw new Error(`No ${selector} block in globals.css`)
  return match[1]
}

export function token(body: string, name: string): string {
  const match = body.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!match?.[1]) throw new Error(`No --${name} in the block`)
  return match[1].trim()
}

export type Oklch = [l: number, c: number, h: number]

export function parseOklch(value: string): Oklch {
  const match = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/)
  if (!match) throw new Error(`Not a plain oklch() value: ${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** A gamma-encoded sRGB colour, each channel 0–1. */
export type Srgb = [r: number, g: number, b: number]

/** OKLCH → gamma-encoded sRGB, clipping out-of-gamut channels. */
export function toSrgb([l, c, h]: Oklch): Srgb {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
    .map((v) => Math.min(1, Math.max(0, v)))
    .map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)) as Srgb
}

/**
 * `colour` at `alpha` painted over `backdrop`. Browsers blend in gamma-encoded
 * sRGB, so this does too.
 */
export function over(colour: Srgb, alpha: number, backdrop: Srgb): Srgb {
  return colour.map((v, i) => v * alpha + backdrop[i]! * (1 - alpha)) as Srgb
}

function luminance(colour: Srgb): number {
  const [r, g, b] = colour.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** WCAG contrast ratio between two sRGB colours. */
export function srgbContrast(x: Srgb, y: Srgb): number {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** WCAG contrast ratio between two OKLCH colours. */
export function contrast(x: Oklch, y: Oklch): number {
  return srgbContrast(toSrgb(x), toSrgb(y))
}

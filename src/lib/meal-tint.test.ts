import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The meal tint (docs/DESIGN.md → Imagery) fixes lightness and chroma so that
 * every meal gets the same contrast, whatever its hue. axe in Storybook sees
 * three hues; this measures every pairing on a tinted surface against all 360,
 * straight from the tokens in globals.css.
 */

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

function block(selector: string): string {
  const match = css.match(new RegExp(`\\n${selector.replace('.', '\\.')} \\{([^}]*)\\}`))
  if (!match?.[1]) throw new Error(`No ${selector} block in globals.css`)
  return match[1]
}

function token(body: string, name: string): string {
  const match = body.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!match?.[1]) throw new Error(`No --${name} in the block`)
  return match[1].trim()
}

type Oklch = [l: number, c: number, h: number]

function parseOklch(value: string): Oklch {
  const match = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/)
  if (!match) throw new Error(`Not a plain oklch() value: ${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** OKLCH → relative luminance, clipping out-of-gamut channels to sRGB. */
function luminance([l, c, h]: Oklch): number {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((v) => Math.min(1, Math.max(0, v)))
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!
}

function contrast(x: Oklch, y: Oklch): number {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const HUES = Array.from({ length: 360 }, (_, h) => h)

describe.each([
  { theme: 'light', body: block(':root') },
  { theme: 'dark', body: block('.dark') },
])('meal tint tokens ($theme)', ({ body }) => {
  const at = (name: string, hue: number): Oklch => [
    Number(token(body, `meal-${name}-l`)),
    Number(token(body, `meal-${name}-c`)),
    hue,
  ]

  // The worst hue for each pairing, so a failure names where it breaks.
  function worst(pair: (hue: number) => number) {
    return HUES.map((hue) => ({ hue, ratio: pair(hue) })).reduce((a, b) =>
      b.ratio < a.ratio ? b : a,
    )
  }

  it('keeps text on the surface at 4.5:1 for every hue', () => {
    expect(worst((h) => contrast(at('text', h), at('surface', h))).ratio).toBeGreaterThanOrEqual(
      4.5,
    )
  })

  it('keeps muted text on the surface at 4.5:1 for every hue', () => {
    expect(worst((h) => contrast(at('muted', h), at('surface', h))).ratio).toBeGreaterThanOrEqual(
      4.5,
    )
  })

  it('keeps chip text at 5:1 for every hue, like the status pairings', () => {
    expect(worst((h) => contrast(at('text', h), at('chip', h))).ratio).toBeGreaterThanOrEqual(5)
  })

  // Colours the card keeps from the theme: the pantry-coded ingredient names
  // and the source link sit on the tint too.
  it.each(['success', 'warning', 'primary'])('keeps --%s at 4.5:1 on the surface', (name) => {
    const colour = parseOklch(token(body, name))
    expect(worst((h) => contrast(colour, at('surface', h))).ratio).toBeGreaterThanOrEqual(4.5)
  })
})

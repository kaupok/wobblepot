import { describe, expect, it } from 'vitest'
import { block, contrast, parseOklch, token, type Oklch } from '@/test/oklch-contrast'

/**
 * The meal tint (docs/DESIGN.md → Imagery) fixes lightness and chroma so that
 * every meal gets the same contrast, whatever its hue. axe in Storybook sees
 * three hues; this measures every pairing on a tinted surface against all 360,
 * straight from the tokens in globals.css.
 */

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

/**
 * A meal note's slip (`StickyNote`) has one hue, 95, and its own lightness and
 * chroma, so each pairing is a single measurement. It is held to the same
 * floors as the meal tint.
 */
describe.each([
  { theme: 'light', body: block(':root') },
  { theme: 'dark', body: block('.dark') },
])('sticky note tokens ($theme)', ({ body }) => {
  const STICKY_HUE = 95
  const at = (name: string): Oklch => [
    Number(token(body, `sticky-${name}-l`)),
    Number(token(body, `sticky-${name}-c`)),
    STICKY_HUE,
  ]

  it('keeps text on the slip at 4.5:1', () => {
    expect(contrast(at('text'), at('surface'))).toBeGreaterThanOrEqual(4.5)
  })

  // Muted is the counter's caption and the focus ring.
  it('keeps muted text on the slip at 4.5:1', () => {
    expect(contrast(at('muted'), at('surface'))).toBeGreaterThanOrEqual(4.5)
  })

  // The chip is a ghost button's hover inside the slip.
  it('keeps text on the chip at 5:1', () => {
    expect(contrast(at('text'), at('chip'))).toBeGreaterThanOrEqual(5)
  })

  // Save is the theme's `default` button, and its fill is the edge it shows on the slip.
  it('keeps --primary at 4.5:1 on the slip', () => {
    expect(contrast(parseOklch(token(body, 'primary')), at('surface'))).toBeGreaterThanOrEqual(4.5)
  })
})

/**
 * The shopping note (`[data-surface='note']`): Today's `UrgentShopping` and the
 * list's sheet on Pantry & shopping (HON-1016). One hue, 95, its own surface
 * lightness and chroma, and the meal tint's text, muted and chip values. The
 * dark sheet is lighter than a dark meal tint, so "paler only gains contrast"
 * holds in the light theme alone; this measures both.
 */
describe.each([
  { theme: 'light', body: block(':root') },
  { theme: 'dark', body: block('.dark') },
])('shopping note tokens ($theme)', ({ body }) => {
  const NOTE_HUE = 95
  const at = (name: string): Oklch => [
    Number(token(body, `meal-${name}-l`)),
    Number(token(body, `meal-${name}-c`)),
    NOTE_HUE,
  ]
  const surface: Oklch = [
    Number(token(body, 'note-surface-l')),
    Number(token(body, 'note-surface-c')),
    NOTE_HUE,
  ]

  it('keeps text on the note at 4.5:1', () => {
    expect(contrast(at('text'), surface)).toBeGreaterThanOrEqual(4.5)
  })

  // Muted is the list's summary line, due dates and the focus ring.
  it('keeps muted text on the note at 4.5:1', () => {
    expect(contrast(at('muted'), surface)).toBeGreaterThanOrEqual(4.5)
  })

  // The chip is a `secondary` fill and a quiet button's hover.
  it('keeps text on the chip at 5:1', () => {
    expect(contrast(at('text'), at('chip'))).toBeGreaterThanOrEqual(5)
  })

  // `--warning` is a row's due-today date; `--primary` the empty state's
  // button and a checked box.
  it.each(['warning', 'primary'])('keeps --%s at 4.5:1 on the note', (name) => {
    expect(contrast(parseOklch(token(body, name)), surface)).toBeGreaterThanOrEqual(4.5)
  })
})

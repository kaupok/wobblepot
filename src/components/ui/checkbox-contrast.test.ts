import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  block,
  contrast,
  over,
  parseOklch,
  srgbContrast,
  toSrgb,
  token,
  type Oklch,
} from '@/test/oklch-contrast'

/**
 * An unticked checkbox or radio is only its border, so the border is the
 * control's whole visual cue and needs 3:1 against what it sits on (WCAG
 * 1.4.11, HON-1019). It draws in `muted-foreground`, which the note sheet
 * re-scopes to its tint, so each surface pairs with its own muted value.
 */

const FLOOR = 3
const NOTE_HUE = 95

// The measurement below is only about what ships if the primitives use it.
describe.each(['checkbox.tsx', 'radio-group.tsx'])('%s border', (file) => {
  const source = readFileSync(join(process.cwd(), 'src/components/ui', file), 'utf8')

  it('draws the unticked border in muted-foreground, not input', () => {
    expect(source).toMatch(/[\s']border-muted-foreground[\s']/)
    expect(source).not.toMatch(/[\s']border-input[\s']/)
  })

  it('fills the dark box with input at 30%, as measured below', () => {
    expect(source).toMatch(/[\s']dark:bg-input\/30[\s']/)
  })
})

const light = block(':root')
const dark = block('.dark')

function note(body: string, name: string): Oklch {
  return [Number(token(body, `${name}-l`)), Number(token(body, `${name}-c`)), NOTE_HUE]
}

describe.each([
  {
    surface: 'light background',
    border: parseOklch(token(light, 'muted-foreground')),
    under: parseOklch(token(light, 'background')),
  },
  {
    surface: 'light card',
    border: parseOklch(token(light, 'muted-foreground')),
    under: parseOklch(token(light, 'card')),
  },
  {
    surface: 'light note sheet',
    border: note(light, 'meal-muted'),
    under: note(light, 'note-surface'),
  },
  {
    surface: 'dark background',
    border: parseOklch(token(dark, 'muted-foreground')),
    under: parseOklch(token(dark, 'background')),
  },
  {
    surface: 'dark card',
    border: parseOklch(token(dark, 'muted-foreground')),
    under: parseOklch(token(dark, 'card')),
  },
  {
    surface: 'dark note sheet',
    border: note(dark, 'meal-muted'),
    under: note(dark, 'note-surface'),
  },
])('unticked border on the $surface', ({ border, under }) => {
  it(`measures at least ${FLOOR}:1 against the surface`, () => {
    expect(contrast(border, under)).toBeGreaterThanOrEqual(FLOOR)
  })
})

/**
 * In the dark theme the box is filled with `--input` at 30%, so the border
 * also sits against that fill on its inner edge. `--input` is translucent
 * white on the neutral theme and the opaque chip on the note sheet.
 */
describe.each([
  {
    surface: 'dark background',
    border: parseOklch(token(dark, 'muted-foreground')),
    under: parseOklch(token(dark, 'background')),
    input: translucentWhite(token(dark, 'input')),
  },
  {
    surface: 'dark card',
    border: parseOklch(token(dark, 'muted-foreground')),
    under: parseOklch(token(dark, 'card')),
    input: translucentWhite(token(dark, 'input')),
  },
  {
    surface: 'dark note sheet',
    border: note(dark, 'meal-muted'),
    under: note(dark, 'note-surface'),
    input: { colour: note(dark, 'meal-chip'), alpha: 1 },
  },
])('unticked border on the $surface, against the box fill', ({ border, under, input }) => {
  it(`measures at least ${FLOOR}:1 against the fill`, () => {
    const fill = over(toSrgb(input.colour), input.alpha * 0.3, toSrgb(under))
    expect(srgbContrast(toSrgb(border), fill)).toBeGreaterThanOrEqual(FLOOR)
  })
})

/** The dark `--input`, `oklch(1 0 0 / 15%)`: white at an alpha. */
function translucentWhite(value: string): { colour: Oklch; alpha: number } {
  const match = value.match(/^oklch\(1 0 0 \/ ([\d.]+)%\)$/)
  if (!match) throw new Error(`Not translucent white: ${value}`)
  return { colour: [1, 0, 0], alpha: Number(match[1]) / 100 }
}

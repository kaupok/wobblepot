import { describe, expect, it } from 'vitest'

import { block, contrast, parseOklch, token } from '@/test/oklch-contrast'

/**
 * A row that turns `bg-muted` or `bg-accent` on hover, focus or keyboard
 * highlight keeps its muted hint (a category, a "matched as" note), so
 * `muted-foreground` needs 4.5:1 on those surfaces as well as on the page
 * (WCAG 1.4.3, HON-1296).
 */

const FLOOR = 4.5

const light = block(':root')
const dark = block('.dark')

describe.each([
  { theme: 'light', body: light, surface: 'background' },
  { theme: 'light', body: light, surface: 'muted' },
  { theme: 'light', body: light, surface: 'accent' },
  { theme: 'dark', body: dark, surface: 'background' },
  { theme: 'dark', body: dark, surface: 'muted' },
  { theme: 'dark', body: dark, surface: 'accent' },
])('muted-foreground on $surface ($theme)', ({ body, surface }) => {
  it(`measures at least ${FLOOR}:1`, () => {
    const text = parseOklch(token(body, 'muted-foreground'))
    const under = parseOklch(token(body, surface))
    expect(contrast(text, under)).toBeGreaterThanOrEqual(FLOOR)
  })
})

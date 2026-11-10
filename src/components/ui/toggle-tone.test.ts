import { describe, expect, it } from 'vitest'

import { block, contrast, parseOklch, token } from '@/test/oklch-contrast'

/**
 * A pressed `warning` toggle (the stock control's Low and Ran out, HON-1641)
 * sets `--warning` text on a `--warning-muted` fill. axe in Storybook sees the
 * pairings a story renders; this measures the tokens in globals.css, in both
 * themes. `PantryStockControl` → `OnNote` / `OnNoteDark` render the parts on
 * the yellow note sheet, where axe measures them.
 */
describe.each([
  { theme: 'light', body: block(':root') },
  { theme: 'dark', body: block('.dark') },
])('warning toggle tokens ($theme)', ({ body }) => {
  const warning = parseOklch(token(body, 'warning'))

  it('keeps warning text on the warning-muted fill at 4.5:1', () => {
    expect(contrast(warning, parseOklch(token(body, 'warning-muted')))).toBeGreaterThanOrEqual(4.5)
  })
})

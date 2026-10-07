import { describe, expect, it } from 'vitest'
import { LABEL_GAP_PX, placeMiddleLabel } from './use-macro-legend-placement'

const place = (rowWidth: number, partCentre: number, labelWidths: [number, number, number]) =>
  placeMiddleLabel({ rowWidth, partCentre, labelWidths, gap: LABEL_GAP_PX })

// Label widths are of the order a 350px cook-view row measures in Chromium.
describe('placeMiddleLabel', () => {
  it('centres the label under a long part (pasta, 18g / 104g / 14g)', () => {
    // Carbs are 68% of the energy, so their part's centre is near 160px.
    expect(place(350, 160, [48, 70, 25])).toBe(125)
  })

  it('keeps 16px after the first label when the part is near the start (curry, 10g / 48g / 38g)', () => {
    // Centred, it would start at 63px, 5px into "Protein".
    expect(place(350, 82, [52, 38, 30])).toBe(52 + LABEL_GAP_PX)
  })

  it('keeps 16px before the last label when the part is near the end', () => {
    expect(place(350, 330, [50, 60, 40])).toBe(350 - 40 - LABEL_GAP_PX - 60)
  })

  it('centres on the boundary it is given when its part is at 0g', () => {
    // The hook passes the protein/fat boundary as the centre.
    expect(place(300, 140, [40, 30, 40])).toBe(125)
  })

  it('places the label when the three labels and two gaps fill the row exactly', () => {
    expect(place(202, 101, [60, 50, 60])).toBe(76)
  })

  it('returns null, for the plain-row fallback, when the labels do not fit', () => {
    expect(place(150, 75, [60, 50, 60])).toBeNull()
  })
})

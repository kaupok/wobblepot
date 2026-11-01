import { describe, expect, it } from 'vitest'

import {
  FRESH_BARE_HERBS,
  INGREDIENT_COVER_PAIRS,
  INGREDIENT_FORM_COVERS,
} from './ingredient-form-covers'

/** The bare rows that hold fresh values, from docs/PROJECT_SPEC.md. */
const FRESH_BARE = ['basil', 'parsley', 'coriander', 'dill', 'mint', 'chives', 'thyme', 'rosemary']
/** The bare rows that hold dried values. */
const DRIED_BARE = ['oregano', 'tarragon', 'sage', 'marjoram']

describe('INGREDIENT_COVER_PAIRS', () => {
  it('lets a form row cover its bare row', () => {
    expect(INGREDIENT_COVER_PAIRS).toContainEqual(['fresh basil', 'basil'])
    expect(INGREDIENT_COVER_PAIRS).toContainEqual(['dried basil', 'basil'])
    expect(INGREDIENT_COVER_PAIRS).toContainEqual(['fresh coriander', 'coriander'])
    expect(INGREDIENT_COVER_PAIRS).toContainEqual(['fresh oregano', 'oregano'])
  })

  it.each(FRESH_BARE)('lets bare %s cover its fresh row', (herb) => {
    expect(INGREDIENT_COVER_PAIRS).toContainEqual([herb, `fresh ${herb}`])
  })

  it.each(DRIED_BARE)('does not let bare %s, a dried row, cover its fresh row', (herb) => {
    expect(INGREDIENT_COVER_PAIRS).not.toContainEqual([herb, `fresh ${herb}`])
  })

  it.each([...FRESH_BARE, ...DRIED_BARE])('does not let bare %s cover its dried row', (herb) => {
    expect(INGREDIENT_COVER_PAIRS).not.toContainEqual([herb, `dried ${herb}`])
  })

  it.each([...FRESH_BARE, ...DRIED_BARE])('does not let dried %s cover its fresh row', (herb) => {
    expect(INGREDIENT_COVER_PAIRS).not.toContainEqual([`dried ${herb}`, `fresh ${herb}`])
  })

  it('gives every pantry row one covered row', () => {
    const pantryRows = INGREDIENT_COVER_PAIRS.map(([pantryRow]) => pantryRow)
    expect(new Set(pantryRows).size).toBe(pantryRows.length)
  })

  it('adds one bare → fresh pair per fresh bare herb', () => {
    expect(Object.keys(INGREDIENT_FORM_COVERS)).toHaveLength(23)
    expect(INGREDIENT_COVER_PAIRS).toHaveLength(23 + 8)
  })
})

describe('FRESH_BARE_HERBS', () => {
  it('names only herbs that have a fresh row in the table', () => {
    for (const herb of FRESH_BARE_HERBS) {
      expect(INGREDIENT_FORM_COVERS[`fresh ${herb}`]).toBe(herb)
    }
  })
})

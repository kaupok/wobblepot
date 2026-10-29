import { describe, expect, it } from 'vitest'

import { fridgeItemsSchema } from './fridge-items'

describe('fridgeItemsSchema', () => {
  it('refuses the same dinner twice on one lunch (HON-1441)', () => {
    const parsed = fridgeItemsSchema.safeParse([
      { sourceEntryId: 'entry-a', servings: 2 },
      { label: 'Bread' },
      { sourceEntryId: 'entry-a', servings: 2 },
    ])

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues).toEqual([
      expect.objectContaining({
        path: [2],
        message: 'Each dinner can appear once on a lunch. Send each sourceEntryId once.',
      }),
    ])
  })

  it('accepts two different dinners', () => {
    const items = [{ sourceEntryId: 'entry-a', servings: 2 }, { sourceEntryId: 'entry-b' }]

    expect(fridgeItemsSchema.parse(items)).toEqual(items)
  })

  it('accepts two free-text items with the same label', () => {
    const items = [{ label: 'Bread' }, { label: 'Bread' }]

    expect(fridgeItemsSchema.parse(items)).toEqual(items)
  })
})

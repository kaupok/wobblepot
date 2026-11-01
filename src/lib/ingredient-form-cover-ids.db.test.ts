import { describe, expect, it } from 'vitest'

import { loadCoverIds } from '@/lib/ingredient-form-cover-ids'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project, with no mocks. The
// migrations seed part of the global catalogue, so a row may already exist.

const NUTRITION = {
  category: 'spice',
  defaultUnit: 'g',
  calories: 250,
  protein: 20,
  carbs: 50,
  fat: 4,
} as const

async function globalId(name: string): Promise<string> {
  const row =
    (await prisma.ingredient.findFirst({ where: { householdId: null, name } })) ??
    (await prisma.ingredient.create({ data: { name, ...NUTRITION } }))
  return row.id
}

describe('loadCoverIds', () => {
  it('maps the global form rows to their global bare row', async () => {
    const basil = await globalId('basil')
    const driedBasil = await globalId('dried basil')
    const freshBasil = await globalId('fresh basil')
    const coriander = await globalId('coriander')
    const freshCoriander = await globalId('fresh coriander')

    const covers = await loadCoverIds()

    expect(covers.get(driedBasil)).toBe(basil)
    expect(covers.get(freshBasil)).toBe(basil)
    expect(covers.get(freshCoriander)).toBe(coriander)
  })

  it('maps the global bare row to its global fresh row only (HON-1567)', async () => {
    const basil = await globalId('basil')
    await globalId('dried basil')
    const freshBasil = await globalId('fresh basil')
    const coriander = await globalId('coriander')
    const freshCoriander = await globalId('fresh coriander')

    const covers = await loadCoverIds()

    expect(covers.get(basil)).toBe(freshBasil)
    expect(covers.get(coriander)).toBe(freshCoriander)
  })

  it('does not cover a legume or a ground spice', async () => {
    await globalId('coriander')
    await globalId('chickpeas')
    const driedChickpeas = await globalId('dried chickpeas')
    const groundCoriander = await globalId('ground coriander')

    const covers = await loadCoverIds()

    expect(covers.has(driedChickpeas)).toBe(false)
    expect(covers.has(groundCoriander)).toBe(false)
  })

  it('ignores a household row named like a form row', async () => {
    const household = await prisma.household.create({ data: { name: 'Alder' } })
    await globalId('basil')
    const own = await prisma.ingredient.create({
      data: { name: 'dried basil', householdId: household.id, ...NUTRITION },
    })

    expect((await loadCoverIds()).has(own.id)).toBe(false)
  })
})

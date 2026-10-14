import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  addCustomShoppingItem,
  clearCheckedCustomShoppingItems,
  deleteCustomShoppingItem,
  updateCustomShoppingItem,
} from '@/lib/shopping/custom-items'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks:
// rows are written with Prisma, changed through the lib functions, and read
// back. The route tests cover only how the routes map these answers (HON-1208).
//
// The migrations seed a global ingredient pool, so the item names here are
// invented words that match no seeded ingredient.

const INGREDIENT = {
  category: 'spice',
  defaultUnit: 'g',
  calories: 1,
  protein: 0,
  carbs: 0,
  fat: 0,
} as const

/**
 * Alder (English) and Birch (Estonian) are two households. `ing-global` is a
 * global ingredient with an Estonian name, `ing-alder` is Alder's own and
 * `ing-birch` is Birch's own.
 */
async function world() {
  const alder = await prisma.household.create({ data: { id: 'hh-alder', name: 'Alder' } })
  const birch = await prisma.household.create({
    data: { id: 'hh-birch', name: 'Birch', locale: 'et' },
  })
  await prisma.ingredient.create({
    data: {
      ...INGREDIENT,
      id: 'ing-global',
      name: 'quorbleberry',
      translations: { create: { locale: 'et', name: 'vimpsumari' } },
    },
  })
  await prisma.ingredient.create({
    data: { ...INGREDIENT, id: 'ing-alder', name: 'zentrafloss', householdId: alder.id },
  })
  await prisma.ingredient.create({
    data: { ...INGREDIENT, id: 'ing-birch', name: 'plinkvortex', householdId: birch.id },
  })
  return { alder, birch }
}

const itemRow = (id: string) => prisma.customShoppingItem.findUnique({ where: { id } })

const pantryRow = (householdId: string, ingredientId: string) =>
  prisma.pantryItem.findUnique({
    where: { householdId_ingredientId: { householdId, ingredientId } },
  })

describe('addCustomShoppingItem', () => {
  it('creates an item linked to a matching global ingredient', async () => {
    const { alder } = await world()

    const outcome = await addCustomShoppingItem(alder, 'quorbleberry')

    expect(outcome).toEqual({
      status: 'created',
      item: {
        id: expect.any(String),
        householdId: 'hh-alder',
        name: 'quorbleberry',
        ingredientId: 'ing-global',
        checked: false,
        createdAt: expect.any(Date),
        ingredient: { id: 'ing-global', name: 'quorbleberry', category: 'spice' },
      },
    })
    const rows = await prisma.customShoppingItem.findMany({ where: { householdId: 'hh-alder' } })
    expect(rows.map((row) => [row.name, row.ingredientId, row.checked])).toEqual([
      ['quorbleberry', 'ing-global', false],
    ])
  })

  it("links the household's own ingredient", async () => {
    const { alder } = await world()

    const outcome = await addCustomShoppingItem(alder, 'zentrafloss')

    expect(outcome.status).toBe('created')
    const [row] = await prisma.customShoppingItem.findMany({ where: { householdId: 'hh-alder' } })
    expect(row?.ingredientId).toBe('ing-alder')
  })

  // HON-889: Birch's ingredient matches the name exactly, Alder's own only
  // closely, and the item still links Alder's own.
  it("never links another household's ingredient, even when it matches better", async () => {
    const { alder } = await world()
    await prisma.ingredient.create({
      data: { ...INGREDIENT, id: 'ing-alder-close', name: 'plinkvortexes', householdId: alder.id },
    })

    await addCustomShoppingItem(alder, 'plinkvortex')

    const [row] = await prisma.customShoppingItem.findMany({ where: { householdId: 'hh-alder' } })
    expect(row?.ingredientId).toBe('ing-alder-close')
  })

  it("leaves the item unlinked when only another household's ingredient matches", async () => {
    const { alder } = await world()

    await addCustomShoppingItem(alder, 'plinkvortex')

    const [row] = await prisma.customShoppingItem.findMany({ where: { householdId: 'hh-alder' } })
    expect(row?.name).toBe('plinkvortex')
    expect(row?.ingredientId).toBeNull()
  })

  // HON-911: an Estonian household types item names in Estonian.
  it("matches an Estonian household's item through the ingredient's Estonian name", async () => {
    const { birch } = await world()

    await addCustomShoppingItem(birch, 'vimpsumari')

    const [row] = await prisma.customShoppingItem.findMany({ where: { householdId: 'hh-birch' } })
    expect(row?.ingredientId).toBe('ing-global')
  })

  it("does not match an English household's item through an Estonian name", async () => {
    const { alder } = await world()

    await addCustomShoppingItem(alder, 'vimpsumari')

    const [row] = await prisma.customShoppingItem.findMany({ where: { householdId: 'hh-alder' } })
    expect(row?.ingredientId).toBeNull()
  })

  it('reopens a checked item with the same name instead of adding a second one', async () => {
    const { alder } = await world()
    await prisma.customShoppingItem.create({
      data: {
        id: 'item-1',
        householdId: alder.id,
        name: 'zentrafloss',
        ingredientId: 'ing-alder',
        checked: true,
      },
    })

    const outcome = await addCustomShoppingItem(alder, 'zentrafloss')

    expect(outcome).toEqual({
      status: 'reopened',
      item: {
        id: 'item-1',
        householdId: 'hh-alder',
        name: 'zentrafloss',
        ingredientId: 'ing-alder',
        checked: false,
        createdAt: expect.any(Date),
        ingredient: { id: 'ing-alder', name: 'zentrafloss', category: 'spice' },
      },
    })
    expect(await prisma.customShoppingItem.count()).toBe(1)
    expect((await itemRow('item-1'))?.checked).toBe(false)
  })

  it('answers exists for an unchecked item with the same name and adds no row', async () => {
    const { alder } = await world()
    await prisma.customShoppingItem.create({
      data: { id: 'item-1', householdId: alder.id, name: 'zentrafloss' },
    })

    const outcome = await addCustomShoppingItem(alder, 'zentrafloss')

    expect(outcome).toEqual({
      status: 'exists',
      existing: {
        id: 'item-1',
        householdId: 'hh-alder',
        name: 'zentrafloss',
        ingredientId: null,
        checked: false,
        createdAt: expect.any(Date),
      },
    })
    expect(await prisma.customShoppingItem.count()).toBe(1)
  })

  it('adds a name that another household already has on its list', async () => {
    const { alder, birch } = await world()
    await prisma.customShoppingItem.create({
      data: { id: 'item-birch', householdId: birch.id, name: 'zentrafloss', checked: true },
    })

    const outcome = await addCustomShoppingItem(alder, 'zentrafloss')

    expect(outcome.status).toBe('created')
    expect(await prisma.customShoppingItem.count()).toBe(2)
    expect((await itemRow('item-birch'))?.checked).toBe(true)
  })

  it('leaves one row when the same name is added twice at once', async () => {
    const { alder } = await world()

    const outcomes = await Promise.all([
      addCustomShoppingItem(alder, 'zentrafloss'),
      addCustomShoppingItem(alder, 'zentrafloss'),
    ])

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['created', 'exists'])
    expect(await prisma.customShoppingItem.count()).toBe(1)
  })
})

describe('updateCustomShoppingItem', () => {
  /** Alder's unchecked item, linked to its own ingredient unless told otherwise. */
  async function alderItem(data: { checked?: boolean; ingredientId?: string | null } = {}) {
    await world()
    await prisma.customShoppingItem.create({
      data: {
        id: 'item-1',
        householdId: 'hh-alder',
        name: 'zentrafloss',
        ingredientId: 'ing-alder',
        ...data,
      },
    })
  }

  it('answers not_found for an unknown id', async () => {
    await alderItem()

    expect(await updateCustomShoppingItem('hh-alder', 'item-nope', { checked: true })).toEqual({
      status: 'not_found',
    })
  })

  it("answers not_found for another household's item and leaves it unchanged", async () => {
    await alderItem()

    expect(await updateCustomShoppingItem('hh-birch', 'item-1', { checked: true })).toEqual({
      status: 'not_found',
    })
    const row = await itemRow('item-1')
    expect([row?.checked, row?.ingredientId]).toEqual([false, 'ing-alder'])
    expect(await prisma.pantryItem.count()).toBe(0)
  })

  it("answers ingredient_not_found for another household's ingredient and leaves the item unchanged", async () => {
    await alderItem()

    expect(
      await updateCustomShoppingItem('hh-alder', 'item-1', { ingredientId: 'ing-birch' }),
    ).toEqual({ status: 'ingredient_not_found' })
    expect((await itemRow('item-1'))?.ingredientId).toBe('ing-alder')
  })

  it('answers ingredient_not_found for an unknown ingredient', async () => {
    await alderItem()

    expect(
      await updateCustomShoppingItem('hh-alder', 'item-1', { ingredientId: 'ing-nope' }),
    ).toEqual({ status: 'ingredient_not_found' })
  })

  it('answers ingredient_not_found for an empty-string ingredient rather than writing it', async () => {
    await alderItem()

    expect(await updateCustomShoppingItem('hh-alder', 'item-1', { ingredientId: '' })).toEqual({
      status: 'ingredient_not_found',
    })
    expect((await itemRow('item-1'))?.ingredientId).toBe('ing-alder')
  })

  it('relinks the item to a global ingredient without checking it', async () => {
    await alderItem()

    const outcome = await updateCustomShoppingItem('hh-alder', 'item-1', {
      ingredientId: 'ing-global',
    })

    expect(outcome).toEqual({
      status: 'updated',
      item: {
        id: 'item-1',
        householdId: 'hh-alder',
        name: 'zentrafloss',
        ingredientId: 'ing-global',
        checked: false,
        createdAt: expect.any(Date),
        ingredient: { id: 'ing-global', name: 'quorbleberry', category: 'spice' },
      },
      replacedQuantity: null,
    })
    const row = await itemRow('item-1')
    expect([row?.checked, row?.ingredientId]).toEqual([false, 'ing-global'])
    expect(await prisma.pantryItem.count()).toBe(0)
  })

  it('unlinks the item with a null ingredient', async () => {
    await alderItem()

    const outcome = await updateCustomShoppingItem('hh-alder', 'item-1', { ingredientId: null })

    expect(outcome).toMatchObject({
      status: 'updated',
      item: { ingredientId: null, ingredient: null },
    })
    expect((await itemRow('item-1'))?.ingredientId).toBeNull()
  })

  it('checking a linked unchecked item puts its ingredient in the pantry as "have some"', async () => {
    await alderItem()

    const outcome = await updateCustomShoppingItem('hh-alder', 'item-1', { checked: true })

    expect(outcome).toMatchObject({
      status: 'updated',
      item: { id: 'item-1', checked: true },
      replacedQuantity: null,
    })
    expect((await itemRow('item-1'))?.checked).toBe(true)
    const pantry = await pantryRow('hh-alder', 'ing-alder')
    expect([pantry?.quantity, pantry?.isStaple]).toEqual([null, false])
    expect(await prisma.pantryItem.count()).toBe(1)
  })

  it('checking and relinking at once stocks the new ingredient', async () => {
    await alderItem()

    await updateCustomShoppingItem('hh-alder', 'item-1', {
      checked: true,
      ingredientId: 'ing-global',
    })

    expect((await pantryRow('hh-alder', 'ing-global'))?.quantity).toBeNull()
    expect(await pantryRow('hh-alder', 'ing-alder')).toBeNull()
  })

  // HON-1176: the shopping list reads only null as purchased.
  it('checking replaces a pantry quantity with "have some" and returns the quantity it replaced', async () => {
    await alderItem()
    await prisma.pantryItem.create({
      data: { householdId: 'hh-alder', ingredientId: 'ing-alder', quantity: 300, isStaple: true },
    })

    const outcome = await updateCustomShoppingItem('hh-alder', 'item-1', { checked: true })

    expect(outcome).toMatchObject({ status: 'updated', replacedQuantity: 300 })
    const pantry = await pantryRow('hh-alder', 'ing-alder')
    expect([pantry?.quantity, pantry?.isStaple]).toEqual([null, true])
  })

  // HON-1173: a "ran out" 0 is replaced too, but there was nothing to lose.
  it('checking replaces a pantry quantity of 0 with "have some" and returns no replaced quantity', async () => {
    await alderItem()
    await prisma.pantryItem.create({
      data: { householdId: 'hh-alder', ingredientId: 'ing-alder', quantity: 0 },
    })

    const outcome = await updateCustomShoppingItem('hh-alder', 'item-1', { checked: true })

    expect(outcome).toMatchObject({ status: 'updated', replacedQuantity: null })
    expect((await pantryRow('hh-alder', 'ing-alder'))?.quantity).toBeNull()
  })

  it('checking an item that is checked already does not touch the pantry', async () => {
    await alderItem({ checked: true })
    const before = await prisma.pantryItem.create({
      data: { householdId: 'hh-alder', ingredientId: 'ing-alder', quantity: 300 },
    })

    const outcome = await updateCustomShoppingItem('hh-alder', 'item-1', { checked: true })

    expect(outcome).toMatchObject({ status: 'updated', replacedQuantity: null })
    const after = await pantryRow('hh-alder', 'ing-alder')
    expect(after?.quantity).toBe(300)
    expect(after?.updatedAt).toEqual(before.updatedAt)
  })

  it('unchecking an item does not touch the pantry', async () => {
    await alderItem({ checked: true })
    await prisma.pantryItem.create({
      data: { householdId: 'hh-alder', ingredientId: 'ing-alder', quantity: 300 },
    })

    const outcome = await updateCustomShoppingItem('hh-alder', 'item-1', { checked: false })

    expect(outcome).toMatchObject({
      status: 'updated',
      item: { checked: false },
      replacedQuantity: null,
    })
    expect((await itemRow('item-1'))?.checked).toBe(false)
    expect((await pantryRow('hh-alder', 'ing-alder'))?.quantity).toBe(300)
  })

  it('unchecking an item with no pantry row writes none', async () => {
    await alderItem({ checked: true })

    await updateCustomShoppingItem('hh-alder', 'item-1', { checked: false })

    expect(await prisma.pantryItem.count()).toBe(0)
  })

  it('checking an unlinked item writes no pantry row', async () => {
    await alderItem({ ingredientId: null })

    const outcome = await updateCustomShoppingItem('hh-alder', 'item-1', { checked: true })

    expect(outcome).toMatchObject({ status: 'updated', item: { checked: true } })
    expect((await itemRow('item-1'))?.checked).toBe(true)
    expect(await prisma.pantryItem.count()).toBe(0)
  })
})

describe('deleteCustomShoppingItem', () => {
  async function items() {
    await world()
    await prisma.customShoppingItem.createMany({
      data: [
        { id: 'item-alder', householdId: 'hh-alder', name: 'zentrafloss' },
        { id: 'item-birch', householdId: 'hh-birch', name: 'plinkvortex' },
      ],
    })
  }

  it('removes the item and returns true', async () => {
    await items()

    expect(await deleteCustomShoppingItem('hh-alder', 'item-alder')).toBe(true)
    expect(await itemRow('item-alder')).toBeNull()
    expect(await itemRow('item-birch')).not.toBeNull()
  })

  it('returns false for an unknown id', async () => {
    await items()

    expect(await deleteCustomShoppingItem('hh-alder', 'item-nope')).toBe(false)
    expect(await prisma.customShoppingItem.count()).toBe(2)
  })

  it("returns false for another household's item and keeps it", async () => {
    await items()

    expect(await deleteCustomShoppingItem('hh-alder', 'item-birch')).toBe(false)
    expect((await itemRow('item-birch'))?.name).toBe('plinkvortex')
  })
})

describe('clearCheckedCustomShoppingItems', () => {
  it("removes only the household's checked items and returns how many", async () => {
    await world()
    await prisma.customShoppingItem.createMany({
      data: [
        { id: 'alder-checked-1', householdId: 'hh-alder', name: 'one', checked: true },
        { id: 'alder-checked-2', householdId: 'hh-alder', name: 'two', checked: true },
        { id: 'alder-open', householdId: 'hh-alder', name: 'three' },
        { id: 'birch-checked', householdId: 'hh-birch', name: 'one', checked: true },
        { id: 'birch-open', householdId: 'hh-birch', name: 'two' },
      ],
    })

    expect(await clearCheckedCustomShoppingItems('hh-alder')).toBe(2)

    const left = await prisma.customShoppingItem.findMany({ orderBy: { id: 'asc' } })
    expect(left.map((row) => row.id)).toEqual(['alder-open', 'birch-checked', 'birch-open'])
  })

  it('returns 0 when the household has no checked items', async () => {
    await world()
    await prisma.customShoppingItem.createMany({
      data: [
        { id: 'alder-open', householdId: 'hh-alder', name: 'one' },
        { id: 'birch-checked', householdId: 'hh-birch', name: 'one', checked: true },
      ],
    })

    expect(await clearCheckedCustomShoppingItems('hh-alder')).toBe(0)
    expect(await prisma.customShoppingItem.count()).toBe(2)
  })
})

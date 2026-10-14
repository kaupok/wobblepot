import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createEntry,
  deleteEntriesInRange,
  deleteEntry,
  EntryCreateError,
  EntryUpdateError,
  type EntryCreateRefusal,
  updateEntry,
  type EntryPatch,
  type EntryUpdateRefusal,
} from '@/lib/meal-plans/entries'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks:
// rows are written with Prisma, changed through the lib functions, and read
// back. The route test covers only how the route maps these answers.

const INGREDIENTS = ['ing-apple', 'ing-beef', 'ing-salt', 'ing-rice'] as const
type IngredientId = (typeof INGREDIENTS)[number]

/**
 * Alder: two adults and a toddler at 0.5×, so 2.5 servings by default. Its plan
 * has a planned stew dinner. Stew is 100 g beef, 20 g apple and 2 g salt per
 * serving; salad is 50 g apple and 30 g rice. Birch is a second household with
 * its own plan, entry, custom meal and pantry.
 */
async function world() {
  for (const id of INGREDIENTS) {
    await prisma.ingredient.create({
      data: {
        id,
        name: id,
        category: 'spice',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    })
  }
  const member = (name: string, portionMultiplier: number) => ({
    name,
    preferences: { create: { portionMultiplier } },
  })
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      members: { create: [member('A', 1), member('B', 1), member('Toddler', 0.5)] },
      mealPlans: { create: { id: 'plan-alder' } },
    },
  })
  const birch = await prisma.household.create({
    data: {
      name: 'Birch',
      members: { create: [member('C', 1)] },
      mealPlans: { create: { id: 'plan-birch' } },
    },
  })
  const meal = (
    id: string,
    components: Partial<Record<IngredientId, number>>,
    householdId: string | null = null,
  ) =>
    prisma.meal.create({
      data: {
        id,
        name: id,
        householdId,
        components: {
          create: Object.entries(components).map(([ingredientId, quantityPerServing]) => ({
            ingredientId,
            quantityPerServing,
          })),
        },
      },
    })
  await meal('meal-stew', { 'ing-beef': 100, 'ing-apple': 20, 'ing-salt': 2 })
  await meal('meal-salad', { 'ing-apple': 50, 'ing-rice': 30 })
  await meal('meal-empty', {})
  await meal('meal-birch', { 'ing-beef': 10 }, birch.id)
  await prisma.meal.create({
    data: { id: 'meal-deleted', name: 'gone', deletedAt: new Date() },
  })
  await entry('entry-alder', { planId: 'plan-alder', mealId: 'meal-stew' })
  await entry('entry-birch', { planId: 'plan-birch', mealId: 'meal-birch' })
  return { alder, birch }
}

async function entry(
  id: string,
  data: { planId?: string; mealId?: string | null } & Record<string, unknown> = {},
) {
  return prisma.mealPlanEntry.create({
    data: {
      id,
      planId: 'plan-alder',
      date: new Date('2026-10-14T00:00:00Z'),
      mealType: 'dinner',
      ...data,
    },
  })
}

/** Changes the stored Alder entry, as an earlier request would have. */
const setEntry = (data: Record<string, unknown>) =>
  prisma.mealPlanEntry.update({ where: { id: 'entry-alder' }, data })

const readEntry = (id = 'entry-alder') => prisma.mealPlanEntry.findUniqueOrThrow({ where: { id } })

async function stock(
  householdId: string,
  rows: Partial<Record<IngredientId, number | null>>,
  isStaple = false,
) {
  for (const [ingredientId, quantity] of Object.entries(rows)) {
    await prisma.pantryItem.create({ data: { householdId, ingredientId, quantity, isStaple } })
  }
}

/** The household's pantry as `ingredientId → quantity`; a missing key is a deleted row. */
async function pantry(householdId: string) {
  const rows = await prisma.pantryItem.findMany({ where: { householdId } })
  return Object.fromEntries(rows.map((row) => [row.ingredientId, row.quantity]))
}

const update = (patch: EntryPatch, householdId: string, entryId = 'entry-alder') =>
  updateEntry(householdId, 'plan-alder', entryId, patch)

const complete: EntryPatch = { status: 'completed', deductPantry: true }

async function refusalOf(promise: Promise<unknown>): Promise<EntryUpdateRefusal> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof EntryUpdateError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.reason
}

describe('deleteEntry', () => {
  it("deletes an entry of the household's own plan", async () => {
    const { alder } = await world()

    expect(await deleteEntry(alder.id, 'plan-alder', 'entry-alder')).toBe(true)
    expect(await prisma.mealPlanEntry.count({ where: { id: 'entry-alder' } })).toBe(0)
  })

  it("leaves another household's entry in place", async () => {
    const { alder, birch } = await world()

    expect(await deleteEntry(alder.id, 'plan-birch', 'entry-birch')).toBe(false)
    expect(await deleteEntry(birch.id, 'plan-birch', 'entry-alder')).toBe(false)
    expect(await prisma.mealPlanEntry.count()).toBe(2)
  })

  // A household has one plan, so the wrong plan id is another household's.
  // The household and the entry match, so only the plan filter refuses it.
  it('leaves an entry in place when the URL names a plan it is not in', async () => {
    const { alder } = await world()

    expect(await deleteEntry(alder.id, 'plan-birch', 'entry-alder')).toBe(false)
    expect(await prisma.mealPlanEntry.count()).toBe(2)
  })
})

describe('deleteEntriesInRange', () => {
  const day = (d: number) => new Date(Date.UTC(2026, 9, d))

  it("deletes the household's entries dated in [start, end) and counts them", async () => {
    const { alder } = await world()
    await entry('entry-before', { date: day(11) })
    await entry('entry-start', { date: day(12) })
    await entry('entry-end', { date: day(19) })

    // `entry-alder` is on 14 October, inside the range.
    expect(await deleteEntriesInRange(alder.id, 'plan-alder', day(12), day(19))).toBe(2)

    const left = await prisma.mealPlanEntry.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
    })
    expect(left.map((row) => row.id)).toEqual(['entry-before', 'entry-birch', 'entry-end'])
  })

  it("answers null for another household's plan and deletes nothing", async () => {
    const { alder } = await world()
    await entry('entry-birch-2', { planId: 'plan-birch', date: day(15) })

    expect(await deleteEntriesInRange(alder.id, 'plan-birch', day(1), day(31))).toBeNull()
    expect(await prisma.mealPlanEntry.count()).toBe(3)
  })
})

describe('createEntry', () => {
  const date = new Date('2026-10-15T00:00:00Z')

  async function createRefusal(promise: Promise<unknown>): Promise<EntryCreateRefusal> {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    )
    if (!(error instanceof EntryCreateError)) throw new Error(`Expected a refusal, got ${error}`)
    return error.reason
  }

  it('creates a planned entry in an empty slot and returns it', async () => {
    const { alder } = await world()

    const created = await createEntry(alder.id, 'plan-alder', {
      date,
      mealType: 'lunch',
      mealId: 'meal-salad',
    })

    expect(created).toEqual({
      id: expect.any(String),
      date: '2026-10-15',
      mealType: 'lunch',
      status: 'planned',
      mealId: 'meal-salad',
      note: null,
    })
    expect(await readEntry(created.id)).toMatchObject({
      planId: 'plan-alder',
      date,
      mealType: 'lunch',
      mealId: 'meal-salad',
      status: 'planned',
      note: null,
      noteX: null,
      noteY: null,
      servingOverride: null,
      rating: null,
      pantryDeductedAt: null,
    })
  })

  it('creates an empty slot with no meal', async () => {
    const { alder } = await world()

    const created = await createEntry(alder.id, 'plan-alder', { date, mealType: 'dinner' })

    expect((await readEntry(created.id)).mealId).toBeNull()
  })

  // Undo after Clear posts the cleared entry back (HON-1123).
  it("writes a restored entry's fields back, pantry charge included", async () => {
    const { alder } = await world()

    const created = await createEntry(alder.id, 'plan-alder', {
      date,
      mealType: 'dinner',
      mealId: 'meal-stew',
      note: 'Leftovers for lunch',
      noteX: 0.25,
      noteY: 0.75,
      status: 'skipped',
      servingOverride: 6,
      rating: 'down',
      pantryDeducted: true,
    })

    expect(await readEntry(created.id)).toMatchObject({
      mealId: 'meal-stew',
      note: 'Leftovers for lunch',
      noteX: 0.25,
      noteY: 0.75,
      status: 'skipped',
      servingOverride: 6,
      rating: 'down',
      pantryDeductedAt: expect.any(Date),
    })
  })

  it("accepts the household's own meal", async () => {
    const { birch } = await world()

    const created = await createEntry(birch.id, 'plan-birch', {
      date,
      mealType: 'dinner',
      mealId: 'meal-birch',
    })

    expect(created.mealId).toBe('meal-birch')
  })

  it.each(['meal-birch', 'meal-deleted', 'meal-missing'])(
    'refuses %s as mealNotFound and writes nothing',
    async (mealId) => {
      const { alder } = await world()

      expect(
        await createRefusal(
          createEntry(alder.id, 'plan-alder', { date, mealType: 'dinner', mealId }),
        ),
      ).toBe('mealNotFound')
      expect(await prisma.mealPlanEntry.count()).toBe(2)
    },
  )

  // A restore after Clear leaves a slot that was refilled meanwhile alone.
  it('refuses a taken slot as slotTaken and leaves the entry there', async () => {
    const { alder } = await world()

    expect(
      await createRefusal(
        createEntry(alder.id, 'plan-alder', {
          date: new Date('2026-10-14T00:00:00Z'),
          mealType: 'dinner',
          mealId: 'meal-salad',
        }),
      ),
    ).toBe('slotTaken')
    expect((await readEntry()).mealId).toBe('meal-stew')
  })

  it("refuses another household's plan as planNotFound and writes nothing", async () => {
    const { alder } = await world()

    expect(
      await createRefusal(createEntry(alder.id, 'plan-birch', { date, mealType: 'dinner' })),
    ).toBe('planNotFound')
    expect(await prisma.mealPlanEntry.count({ where: { planId: 'plan-birch' } })).toBe(1)
  })
})

describe('updateEntry: plain edits', () => {
  it('writes status, note and rating, and answers with the stored row', async () => {
    const { alder } = await world()

    const result = await update({ status: 'skipped', note: 'Leftovers', rating: 'up' }, alder.id)

    expect(result).toEqual({
      id: 'entry-alder',
      status: 'skipped',
      mealId: 'meal-stew',
      rating: 'up',
    })
    expect(await readEntry()).toMatchObject({ status: 'skipped', note: 'Leftovers', rating: 'up' })
  })

  it("refuses another household's entry and an entry outside the plan, as not found", async () => {
    const { alder, birch } = await world()

    expect(await refusalOf(update({ note: 'x' }, alder.id, 'entry-birch'))).toBe('entryNotFound')
    expect(await refusalOf(update({ note: 'x' }, birch.id))).toBe('entryNotFound')
    expect(await refusalOf(updateEntry(alder.id, 'plan-birch', 'entry-alder', { note: 'x' }))).toBe(
      'entryNotFound',
    )
    expect((await readEntry('entry-birch')).note).toBeNull()
    expect((await readEntry()).note).toBeNull()
  })

  it('refuses a patch that changes nothing, after the entry lookup', async () => {
    const { alder } = await world()

    expect(await refusalOf(update({}, alder.id))).toBe('noFields')
    expect(await refusalOf(update({ deductPantry: true }, alder.id))).toBe('noFields')
    expect(await refusalOf(update({}, alder.id, 'entry-missing'))).toBe('entryNotFound')
  })

  it('drops cached tips when an entry leaves completed, and keeps them otherwise', async () => {
    const { alder } = await world()
    await setEntry({ status: 'completed', preparationTips: 'tips' })

    await update({ status: 'completed' }, alder.id)
    expect((await readEntry()).preparationTips).toBe('tips')

    await update({ status: 'planned' }, alder.id)
    expect((await readEntry()).preparationTips).toBeNull()

    await setEntry({ preparationTips: 'tips' })
    await update({ status: 'skipped' }, alder.id)
    expect((await readEntry()).preparationTips).toBe('tips')
  })
})

describe('updateEntry: note place', () => {
  it('saves both axes while the entry has a note, and refuses them without one', async () => {
    const { alder } = await world()

    expect(await refusalOf(update({ noteX: 0.2, noteY: 0.8 }, alder.id))).toBe('noNote')

    await setEntry({ note: 'Thaw the beef' })
    await update({ noteX: 0.2, noteY: 0.8 }, alder.id)
    expect(await readEntry()).toMatchObject({ noteX: 0.2, noteY: 0.8 })
  })

  it('accepts a place that arrives with a new note, and keeps it when the note is edited', async () => {
    const { alder } = await world()

    await update({ note: 'Thaw', noteX: 0.5, noteY: 0.5 }, alder.id)
    await update({ note: 'Thaw the beef' }, alder.id)

    expect(await readEntry()).toMatchObject({ note: 'Thaw the beef', noteX: 0.5, noteY: 0.5 })
  })

  it('clears the place with the note, and resets it with both axes null', async () => {
    const { alder } = await world()
    await setEntry({ note: 'Thaw', noteX: 0.3, noteY: 0.3 })

    await update({ noteX: null, noteY: null }, alder.id)
    expect(await readEntry()).toMatchObject({ note: 'Thaw', noteX: null, noteY: null })

    await setEntry({ noteX: 0.3, noteY: 0.3 })
    await update({ note: null }, alder.id)
    expect(await readEntry()).toMatchObject({ note: null, noteX: null, noteY: null })
  })
})

describe('updateEntry: servings', () => {
  it('drops cached tips when the count changes, and keeps them when it is resent', async () => {
    const { alder } = await world()
    await setEntry({ servingOverride: 4, preparationTips: 'tips' })

    await update({ servingOverride: 4 }, alder.id)
    expect(await readEntry()).toMatchObject({ servingOverride: 4, preparationTips: 'tips' })

    await update({ servingOverride: null }, alder.id)
    expect(await readEntry()).toMatchObject({ servingOverride: null, preparationTips: null })
  })

  it('refuses a new count on a completed entry, and lets it resend the stored one', async () => {
    const { alder } = await world()
    await setEntry({ status: 'completed', servingOverride: 4 })

    expect(await refusalOf(update({ servingOverride: 6 }, alder.id))).toBe('completedServings')
    expect(await refusalOf(update({ servingOverride: null }, alder.id))).toBe('completedServings')
    expect(
      await refusalOf(update({ status: 'completed', servingOverride: 6, note: 'x' }, alder.id)),
    ).toBe('completedServings')
    await update({ servingOverride: 4, note: 'Ate it all' }, alder.id)

    expect(await readEntry()).toMatchObject({ servingOverride: 4, note: 'Ate it all' })
  })
})

describe('updateEntry: swap', () => {
  it('points the entry at the new meal and resets what described the old one', async () => {
    const { alder } = await world()
    await setEntry({ preparationTips: 'tips', servingOverride: 4, rating: 'up' })

    const result = await update({ mealId: 'meal-salad' }, alder.id)

    expect(result).toEqual({
      id: 'entry-alder',
      status: 'planned',
      mealId: 'meal-salad',
      rating: null,
    })
    expect(await readEntry()).toMatchObject({
      mealId: 'meal-salad',
      preparationTips: null,
      servingOverride: null,
      rating: null,
    })
  })

  it('resets nothing when the patch re-sends the meal already on the entry', async () => {
    const { alder } = await world()
    await setEntry({ preparationTips: 'tips', servingOverride: 4, rating: 'up' })

    await update({ mealId: 'meal-stew' }, alder.id)

    expect(await readEntry()).toMatchObject({
      preparationTips: 'tips',
      servingOverride: 4,
      rating: 'up',
    })
  })

  it('lets an explicit rating and count in the same patch win over the reset', async () => {
    const { alder } = await world()

    await update({ mealId: 'meal-salad', rating: 'down', servingOverride: 3 }, alder.id)

    expect(await readEntry()).toMatchObject({ rating: 'down', servingOverride: 3 })
  })

  it("refuses another household's meal and a deleted meal, and writes nothing", async () => {
    const { alder } = await world()

    expect(await refusalOf(update({ mealId: 'meal-birch' }, alder.id))).toBe('mealNotFound')
    expect(await refusalOf(update({ mealId: 'meal-deleted' }, alder.id))).toBe('mealNotFound')
    expect((await readEntry()).mealId).toBe('meal-stew')
  })

  it('refuses to repoint a completed entry, whatever else the patch carries', async () => {
    const { alder } = await world()
    await setEntry({ status: 'completed' })

    expect(await refusalOf(update({ mealId: 'meal-salad' }, alder.id))).toBe('completedSwap')
    expect(await refusalOf(update({ ...complete, mealId: 'meal-salad' }, alder.id))).toBe(
      'completedSwap',
    )
    expect(await readEntry()).toMatchObject({ mealId: 'meal-stew', status: 'completed' })
  })

  it('still swaps a skipped entry, and a completed entry reverted to planned', async () => {
    const { alder } = await world()
    await setEntry({ status: 'skipped' })
    await update({ mealId: 'meal-salad' }, alder.id)
    expect((await readEntry()).mealId).toBe('meal-salad')

    await setEntry({ status: 'completed' })
    await update({ status: 'planned' }, alder.id)
    await update({ mealId: 'meal-stew' }, alder.id)
    expect((await readEntry()).mealId).toBe('meal-stew')
  })
})

describe('updateEntry: pantry deduction', () => {
  it("charges the meal at the members' portions, and marks the entry charged", async () => {
    const { alder } = await world()
    await stock(alder.id, { 'ing-beef': 1000, 'ing-apple': 100, 'ing-salt': 500 })

    const result = await update(complete, alder.id)

    // 2.5 servings: 250 g beef, 50 g apple, 5 g salt.
    expect(result).toEqual({
      id: 'entry-alder',
      status: 'completed',
      mealId: 'meal-stew',
      rating: undefined,
      pantryDeducted: true,
    })
    expect(await pantry(alder.id)).toEqual({ 'ing-beef': 750, 'ing-apple': 50, 'ing-salt': 495 })
    const stored = await readEntry()
    expect(stored.status).toBe('completed')
    expect(stored.pantryDeductedAt).toBeInstanceOf(Date)
  })

  it('charges the stored override, or the one sent in the same patch', async () => {
    const { alder } = await world()
    await stock(alder.id, { 'ing-beef': 1000 })
    await setEntry({ servingOverride: 2 })
    await entry('entry-lunch', { mealId: 'meal-stew', mealType: 'lunch' })

    await update(complete, alder.id)
    expect(await pantry(alder.id)).toEqual({ 'ing-beef': 800 })

    await update({ ...complete, servingOverride: 4 }, alder.id, 'entry-lunch')
    expect(await pantry(alder.id)).toEqual({ 'ing-beef': 400 })
    expect((await readEntry('entry-lunch')).servingOverride).toBe(4)
  })

  it('leaves staples, rows without a quantity of other ingredients, and other households alone', async () => {
    const { alder, birch } = await world()
    await stock(alder.id, { 'ing-beef': 1000, 'ing-rice': null })
    await stock(alder.id, { 'ing-salt': 500 }, true)
    await stock(birch.id, { 'ing-beef': 1000, 'ing-apple': 100 })

    await update(complete, alder.id)

    expect(await pantry(alder.id)).toEqual({ 'ing-beef': 750, 'ing-rice': null, 'ing-salt': 500 })
    expect(await pantry(birch.id)).toEqual({ 'ing-beef': 1000, 'ing-apple': 100 })
  })

  it('removes the rows the deduction emptied or overshot, and unquantified rows it used', async () => {
    const { alder } = await world()
    await stock(alder.id, { 'ing-beef': 100, 'ing-apple': 50, 'ing-salt': null })

    await update(complete, alder.id)

    expect(await pantry(alder.id)).toEqual({})
  })

  it('charges the incoming meal on a swap-and-complete, at the household size', async () => {
    const { alder } = await world()
    await setEntry({ servingOverride: 6 })
    await stock(alder.id, { 'ing-beef': 1000, 'ing-apple': 1000, 'ing-rice': 1000 })

    const result = await update({ ...complete, mealId: 'meal-salad' }, alder.id)

    expect(result).toMatchObject({ mealId: 'meal-salad', pantryDeducted: true })
    expect(await pantry(alder.id)).toEqual({ 'ing-beef': 1000, 'ing-apple': 875, 'ing-rice': 925 })
  })

  it('charges nothing without deductPantry, or for a meal with no components', async () => {
    const { alder } = await world()
    await stock(alder.id, { 'ing-beef': 1000 })
    await entry('entry-lunch', { mealId: 'meal-empty', mealType: 'lunch' })

    expect(await update({ status: 'completed' }, alder.id)).not.toHaveProperty('pantryDeducted')
    expect(await update(complete, alder.id, 'entry-lunch')).not.toHaveProperty('pantryDeducted')

    expect(await pantry(alder.id)).toEqual({ 'ing-beef': 1000 })
    expect((await readEntry()).pantryDeductedAt).toBeNull()
  })

  it('charges once across complete, revert, complete, and a swap after the revert', async () => {
    const { alder } = await world()
    await stock(alder.id, { 'ing-beef': 1000, 'ing-apple': 1000 })

    await update(complete, alder.id)
    await update(complete, alder.id)
    await update({ status: 'planned' }, alder.id)
    await update(complete, alder.id)
    await update({ status: 'planned' }, alder.id)
    await update({ ...complete, mealId: 'meal-salad' }, alder.id)

    expect(await pantry(alder.id)).toEqual({ 'ing-beef': 750, 'ing-apple': 950 })
    expect(await readEntry()).toMatchObject({ status: 'completed', mealId: 'meal-salad' })
  })
})

describe('updateEntry: the completion transaction', () => {
  // A trigger that fails the beef decrement, which runs after the apple one
  // (the decrements go in ingredient-id order). The failure is the database's
  // own, inside the real transaction.
  async function failBeefDecrement<T>(run: () => Promise<T>): Promise<T> {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION fail_beef() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$`,
    )
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_beef BEFORE UPDATE ON pantry_item FOR EACH ROW WHEN (OLD."ingredientId" = 'ing-beef') EXECUTE FUNCTION fail_beef()`,
    )
    try {
      return await run()
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_beef ON pantry_item`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_beef()`)
    }
  }

  it('rolls back the claim and every decrement when one decrement fails', async () => {
    const { alder } = await world()
    await stock(alder.id, { 'ing-apple': 100, 'ing-beef': 1000 })

    await expect(failBeefDecrement(() => update(complete, alder.id))).rejects.toThrow(/injected/)

    expect(await pantry(alder.id)).toEqual({ 'ing-apple': 100, 'ing-beef': 1000 })
    expect(await readEntry()).toMatchObject({ status: 'planned', pantryDeductedAt: null })

    // Nothing was claimed, so a retry charges the meal once.
    await update(complete, alder.id)
    expect(await pantry(alder.id)).toEqual({ 'ing-apple': 50, 'ing-beef': 750 })
  })
})

// Two requests at once. One connection decides the order, so each test asserts
// the rule rather than one interleaving: the pantry is charged once, for the
// meal and count the entry ends up recording.
describe('updateEntry: concurrent requests', () => {
  const settle = (...patches: EntryPatch[]) =>
    Promise.allSettled(patches.map((patch) => update(patch, alderId)))
  let alderId = ''

  /** The pantry a single deduction of the entry's final meal and count leaves, or the stock untouched. */
  async function expectChargedOnceForTheStoredEntry(start: Record<string, number>) {
    const stored = await prisma.mealPlanEntry.findUniqueOrThrow({
      where: { id: 'entry-alder' },
      include: { meal: { include: { components: true } } },
    })
    const expected = { ...start }
    if (stored.pantryDeductedAt) {
      expect(stored.status).toBe('completed')
      const servings = stored.servingOverride ?? 2.5
      for (const component of stored.meal?.components ?? []) {
        expected[component.ingredientId]! -= component.quantityPerServing * servings
      }
    }
    expect(await pantry(alderId)).toEqual(expected)
  }

  const start = { 'ing-beef': 1000, 'ing-apple': 1000, 'ing-salt': 1000, 'ing-rice': 1000 }

  it('charges a double-submitted completion once', async () => {
    alderId = (await world()).alder.id
    await stock(alderId, start)

    const results = await settle(complete, complete)

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(await pantry(alderId)).toEqual({
      ...start,
      'ing-beef': 750,
      'ing-apple': 950,
      'ing-salt': 995,
    })
  })

  it('never leaves a completion charged for a meal a concurrent swap replaced', async () => {
    alderId = (await world()).alder.id
    await stock(alderId, start)

    await settle(complete, { mealId: 'meal-salad' })

    await expectChargedOnceForTheStoredEntry(start)
  })

  it('never leaves a completion charged at a count a concurrent change replaced', async () => {
    alderId = (await world()).alder.id
    await stock(alderId, start)

    await settle(complete, { servingOverride: 6 })

    await expectChargedOnceForTheStoredEntry(start)
  })
})

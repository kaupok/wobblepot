// Writes the seed data into the global pool (householdId: null). Each function
// reads its table once, compares in memory and writes only the rows that
// differ, because on Neon every query is a 90–150 ms round trip and a deploy
// used to spend 6–11 minutes re-writing values the rows already had (HON-1625).
// A run against a database that already matches sends reads only, and the
// number of reads does not depend on the number of rows.

import type { MealType, PrismaClient, ProteinType } from '../src/generated/prisma/client'
import { normalizeIngredientKey } from '../src/lib/i18n/ingredient-key'
import { MEAL_IMAGE_CLEARED } from '../src/lib/meal-images/invalidation'
import { isMeasuredByVolume } from './measured-by-volume'
import { pieceDisplayFor } from './piece-display'
import type { IngredientTranslationEt } from './seed-ingredient-translations-et'
import type { MealTranslationEt } from './seed-meal-translations-et'
import type { IngredientInput } from './seed-types'

export type SeedClient = Pick<
  PrismaClient,
  'ingredient' | 'meal' | 'mealTranslation' | 'ingredientTranslation'
>

export type SeedMeal = {
  name: string
  description?: string | null
  timeMinutes?: number | null
  kidFriendly?: boolean
  suitableFor?: readonly string[]
  primaryProteinType?: string
  components: readonly { ingredient: string; quantity: number }[]
}

/**
 * True when the seed sets a value the row does not hold. A seed value of
 * `undefined` leaves the column alone in a Prisma update, so it never differs.
 */
function differs<T>(seed: T | undefined, stored: T): boolean {
  return seed !== undefined && seed !== stored
}

function differsList(seed: readonly string[] | undefined, stored: readonly string[]): boolean {
  if (seed === undefined) return false
  return seed.length !== stored.length || seed.some((value, i) => value !== stored[i])
}

function counts(created: number, updated: number, unchanged: number): string {
  return `${created} created, ${updated} updated, ${unchanged} unchanged`
}

function missingTranslationError(missing: string[], what: string): Error {
  const preview = missing.slice(0, 20).join(', ')
  const suffix = missing.length > 20 ? `, …(+${missing.length - 20} more)` : ''
  return new Error(`Missing et translation for ${missing.length} ${what}: ${preview}${suffix}`)
}

export async function seedIngredients(prisma: SeedClient, ingredients: IngredientInput[]) {
  console.log('Seeding ingredients...')

  // Matched by name in code, not with upsert: `Ingredient.name` has a partial
  // unique index per household scope (see migration
  // 20260423120000_i18n_foundation), which Prisma can't model.
  const stored = await prisma.ingredient.findMany({
    where: { householdId: null },
    select: {
      id: true,
      name: true,
      gramsPerPiece: true,
      measuredByVolume: true,
      pieceDisplay: true,
    },
  })
  const byName = new Map<string, (typeof stored)[number]>()
  for (const row of stored) if (!byName.has(row.name)) byName.set(row.name, row)

  const toCreate: IngredientInput[] = []
  let updated = 0

  for (const ingredient of ingredients) {
    const existing = byName.get(ingredient.name)
    if (!existing) {
      toCreate.push(ingredient)
      continue
    }

    // Only these three are re-asserted on an existing row; its category,
    // nutrition and allergens are left alone. gramsPerPiece only when the seed
    // entry carries the key.
    const data = {
      gramsPerPiece: 'gramsPerPiece' in ingredient ? ingredient.gramsPerPiece : undefined,
      measuredByVolume: isMeasuredByVolume(ingredient),
      pieceDisplay: pieceDisplayFor(ingredient),
    }
    if (
      differs(data.gramsPerPiece, existing.gramsPerPiece) ||
      differs(data.measuredByVolume, existing.measuredByVolume) ||
      differs(data.pieceDisplay, existing.pieceDisplay)
    ) {
      await prisma.ingredient.update({ where: { id: existing.id }, data })
      updated++
    }
  }

  if (toCreate.length > 0) {
    await prisma.ingredient.createMany({
      data: toCreate.map((ingredient) => ({
        name: ingredient.name,
        category: ingredient.category,
        subcategory: ingredient.subcategory,
        proteinType: ingredient.proteinType ?? null,
        defaultUnit: ingredient.defaultUnit,
        allergens: ingredient.allergens,
        calories: ingredient.calories,
        protein: ingredient.protein,
        carbs: ingredient.carbs,
        fat: ingredient.fat,
        fiber: ingredient.fiber,
        gramsPerPiece: ingredient.gramsPerPiece ?? null,
        densityGPerMl: ingredient.densityGPerMl ?? null,
        measuredByVolume: isMeasuredByVolume(ingredient),
        pieceDisplay: pieceDisplayFor(ingredient),
      })),
    })
  }

  const unchanged = ingredients.length - toCreate.length - updated
  console.log(
    `Seeded ${ingredients.length} ingredients (${counts(toCreate.length, updated, unchanged)})`,
  )
}

export async function seedMeals(prisma: SeedClient, meals: SeedMeal[]) {
  console.log('Seeding meals...')

  // Map names to IDs from the global pool only, so a household row that shares a
  // global name can never be linked into a global meal.
  const dbIngredients = await prisma.ingredient.findMany({
    where: { householdId: null },
    select: { id: true, name: true },
  })
  const ingredientMap = new Map(dbIngredients.map((i) => [i.name, i.id]))

  const stored = await prisma.meal.findMany({
    where: { householdId: null },
    select: {
      id: true,
      name: true,
      description: true,
      timeMinutes: true,
      kidFriendly: true,
      suitableFor: true,
      primaryProteinType: true,
    },
  })
  const byName = new Map<string, (typeof stored)[number]>()
  for (const row of stored) if (!byName.has(row.name)) byName.set(row.name, row)

  let created = 0
  let updated = 0
  let unchanged = 0
  let skipped = 0

  for (const meal of meals) {
    const missingIngredients = meal.components
      .map((c) => c.ingredient)
      .filter((name) => !ingredientMap.has(name))

    if (missingIngredients.length > 0) {
      console.warn(
        `Skipping "${meal.name}" - missing ingredients: ${missingIngredients.join(', ')}`,
      )
      skipped++
      continue
    }

    const suitableFor = meal.suitableFor as MealType[] | undefined
    const primaryProteinType = meal.primaryProteinType as ProteinType | undefined
    const existing = byName.get(meal.name)

    if (!existing) {
      await prisma.meal.create({
        data: {
          name: meal.name,
          description: meal.description,
          timeMinutes: meal.timeMinutes,
          kidFriendly: meal.kidFriendly,
          suitableFor,
          primaryProteinType,
          householdId: null,
          components: {
            create: meal.components.map((c) => ({
              ingredientId: ingredientMap.get(c.ingredient)!,
              quantityPerServing: c.quantity,
            })),
          },
        },
      })
      created++
      continue
    }

    // An existing meal's name and components are never written.
    const descriptionChanged = differs(meal.description, existing.description)
    if (
      !descriptionChanged &&
      !differs(meal.timeMinutes, existing.timeMinutes) &&
      !differs(meal.kidFriendly, existing.kidFriendly) &&
      !differsList(suitableFor, existing.suitableFor) &&
      !differs(primaryProteinType, existing.primaryProteinType)
    ) {
      unchanged++
      continue
    }

    await prisma.meal.update({
      where: { id: existing.id },
      data: {
        description: meal.description,
        timeMinutes: meal.timeMinutes,
        kidFriendly: meal.kidFriendly,
        suitableFor,
        primaryProteinType,
        // The description feeds the meal image prompt, so a seed edit to it
        // would otherwise leave an illustration of the old dish (HON-734). The
        // blob itself is left orphaned — harmless, and the seed has no Blob
        // credentials to delete it with.
        ...(descriptionChanged ? MEAL_IMAGE_CLEARED : {}),
      },
    })
    updated++
  }

  console.log(
    `Seeded ${created + updated + unchanged} meals (${counts(created, updated, unchanged)}, ${skipped} skipped)`,
  )
}

export async function seedMealTranslationsEt(
  prisma: SeedClient,
  mealTranslationsEt: MealTranslationEt[],
) {
  console.log('Seeding meal translations (et)...')

  // Index translations by their English meal name. Meal names are matched
  // EXACTLY (not normalized like ingredient keys): the name is the seed's
  // identity for a meal, and two meals such as "Shepherd's Pie" (beef, in
  // seed.ts) and "Lamb Shepherd's Pie" (lamb, in seed-expansion.ts) must never
  // share a key. Until HON-1046 the lamb one differed from the beef one only
  // by punctuation; `pnpm db:validate` now rejects names that share a slug. A
  // duplicate enName is therefore a hard error.
  const byName = new Map<string, MealTranslationEt['et']>()
  for (const entry of mealTranslationsEt) {
    if (byName.has(entry.enName)) {
      throw new Error(`Duplicate et meal translation entry for "${entry.enName}"`)
    }
    byName.set(entry.enName, entry.et)
  }

  // Reconcile against the LIVE global meal set rather than iterating the
  // translation array: every seeded global Meal must end up with an `et` row,
  // so a missing translation is a hard failure. This is the guard that would
  // have caught the apostrophe/spacing drift behind HON-546 — a seeded meal
  // silently rendering its English name to `et` households — before it shipped.
  // Mirrors seedIngredientTranslationsEt's "every row" enforcement.
  const globals = await prisma.meal.findMany({
    where: { householdId: null },
    select: { id: true, name: true },
  })
  const stored = await prisma.mealTranslation.findMany({
    where: { locale: 'et', meal: { householdId: null } },
    select: { mealId: true, name: true, description: true, preparationNotes: true },
  })
  const storedByMeal = new Map(stored.map((row) => [row.mealId, row]))

  const missing: string[] = []
  const toCreate: { mealId: string; name: string; description: string | null }[] = []
  let updated = 0
  let unchanged = 0

  for (const meal of globals) {
    const et = byName.get(meal.name)
    if (!et) {
      missing.push(meal.name)
      continue
    }

    const existing = storedByMeal.get(meal.id)
    if (!existing) {
      toCreate.push({ mealId: meal.id, name: et.name, description: et.description })
      continue
    }

    if (
      existing.name === et.name &&
      existing.description === et.description &&
      existing.preparationNotes === null
    ) {
      unchanged++
      continue
    }

    await prisma.mealTranslation.update({
      where: { mealId_locale: { mealId: meal.id, locale: 'et' } },
      data: { name: et.name, description: et.description, preparationNotes: null },
    })
    updated++
  }

  if (toCreate.length > 0) {
    await prisma.mealTranslation.createMany({
      // preparationNotes is intentionally null for every seeded meal: seeded
      // meals carry no English prep notes either, and the meal-detail prep
      // section is driven by the AI preparation-tips feature (HON-523). The
      // field is reserved for user-authored notes, which keep their
      // creator-time locale per the HON-499 content principle.
      // (HON-546 item 4 — confirmed intentional, nothing to translate.)
      data: toCreate.map((row) => ({ ...row, locale: 'et', preparationNotes: null })),
    })
  }

  if (missing.length > 0) throw missingTranslationError(missing, 'seeded meal(s)')

  console.log(
    `Seeded ${toCreate.length + updated + unchanged} meal translations (et) (${counts(toCreate.length, updated, unchanged)})`,
  )
}

export async function seedIngredientTranslationsEt(
  prisma: SeedClient,
  ingredientTranslationsEt: IngredientTranslationEt[],
) {
  console.log('Seeding ingredient translations (et)...')

  // Build a normalized English-name → Estonian lookup. Keying on the normalized
  // name (not the raw string) guards against the apostrophe/spacing drift that
  // silently dropped meal rows in HON-507. See normalizeIngredientKey.
  const byKey = new Map<string, string>()
  for (const entry of ingredientTranslationsEt) {
    const key = normalizeIngredientKey(entry.en)
    if (byKey.has(key)) {
      throw new Error(`Duplicate et ingredient translation entry for "${entry.en}"`)
    }
    byKey.set(key, entry.et)
  }

  // Reconcile against the LIVE global ingredient set rather than iterating the
  // translation array: every seeded global Ingredient must end up with an `et`
  // row, so a missing translation is a hard failure (proves the "every row" AC).
  const globals = await prisma.ingredient.findMany({
    where: { householdId: null },
    select: { id: true, name: true },
  })
  const stored = await prisma.ingredientTranslation.findMany({
    where: { locale: 'et', ingredient: { householdId: null } },
    select: { ingredientId: true, name: true },
  })
  const storedByIngredient = new Map(stored.map((row) => [row.ingredientId, row.name]))

  const missing: string[] = []
  const toCreate: { ingredientId: string; name: string }[] = []
  let updated = 0
  let unchanged = 0

  for (const ingredient of globals) {
    const et = byKey.get(normalizeIngredientKey(ingredient.name))
    if (!et) {
      missing.push(ingredient.name)
      continue
    }

    const existing = storedByIngredient.get(ingredient.id)
    if (existing === undefined) {
      toCreate.push({ ingredientId: ingredient.id, name: et })
    } else if (existing === et) {
      unchanged++
    } else {
      await prisma.ingredientTranslation.update({
        where: { ingredientId_locale: { ingredientId: ingredient.id, locale: 'et' } },
        data: { name: et },
      })
      updated++
    }
  }

  if (toCreate.length > 0) {
    await prisma.ingredientTranslation.createMany({
      data: toCreate.map((row) => ({ ...row, locale: 'et' })),
    })
  }

  if (missing.length > 0) throw missingTranslationError(missing, 'global ingredient(s)')

  console.log(
    `Seeded ${toCreate.length + updated + unchanged} ingredient translations (et) (${counts(toCreate.length, updated, unchanged)})`,
  )
}

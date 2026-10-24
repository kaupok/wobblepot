import 'server-only'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { getTodayInTimezone, parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { ingredientTranslationsInclude, translateIngredient } from '@/lib/i18n/content'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { addCustomShoppingItem } from '@/lib/shopping/custom-items'
import type { DayExtraView } from '@/components/meal-plan/types'
import type { CreateDayExtraInput } from './schemas'

/**
 * Day extras (HON-1309): a snack, a drink or another item a household adds to
 * a day, outside its meals. Shared by `/api/extras`, `/api/extras/[id]` and
 * the Today page, so the server render and the routes cannot drift.
 */

interface ExtrasHousehold {
  id: string
  locale: string | null
}

function extraSelect(locale: string) {
  return {
    id: true,
    date: true,
    label: true,
    quantity: true,
    ingredient: {
      select: {
        id: true,
        name: true,
        defaultUnit: true,
        measuredByVolume: true,
        ...ingredientTranslationsInclude(locale),
      },
    },
  } satisfies Prisma.DayExtraSelect
}

type ExtraRow = Prisma.DayExtraGetPayload<{ select: ReturnType<typeof extraSelect> }>

function toView(row: ExtraRow, locale: string): DayExtraView {
  const ingredient = row.ingredient && translateIngredient(row.ingredient, locale)
  return {
    id: row.id,
    date: toDateString(row.date),
    ingredientId: ingredient?.id ?? null,
    // The CHECK sets exactly one of the two.
    name: ingredient?.name ?? row.label!,
    quantity: row.quantity,
    unit: ingredient ? displayUnit(ingredient) : null,
  }
}

/** The household's extras in `[startDate, endDate)`, by day and then in the order they were added. */
export async function loadDayExtras(
  household: ExtrasHousehold,
  { startDate, endDate }: { startDate: Date; endDate: Date },
): Promise<DayExtraView[]> {
  const locale = resolveHouseholdLocale(household)
  const rows = await prisma.dayExtra.findMany({
    where: { householdId: household.id, date: { gte: startDate, lt: endDate } },
    orderBy: [{ date: 'asc' }, { position: 'asc' }],
    select: extraSelect(locale),
  })
  return rows.map((row) => toView(row, locale))
}

export type CreateDayExtraOutcome =
  | { status: 'created'; extra: DayExtraView }
  | { status: 'past_date' }
  | { status: 'ingredient_not_found' }

/**
 * Adds an extra at the end of its day. A day before today in the household's
 * timezone is refused, because a past extra shows nowhere. The ingredient
 * must be global or the household's own.
 *
 * A free-text extra also goes on the shopping list as a manual item with the
 * same name. That is a one-time copy: a later change or Remove on the extra
 * leaves the item alone. A name already on the list is not added twice.
 */
export async function createDayExtra(
  household: ExtrasHousehold & { timezone: string },
  input: CreateDayExtraInput,
): Promise<CreateDayExtraOutcome> {
  if (input.date < getTodayInTimezone(household.timezone)) return { status: 'past_date' }

  const ingredientId = 'ingredientId' in input ? input.ingredientId : null
  if (ingredientId) {
    const found = await prisma.ingredient.count({
      where: { id: ingredientId, OR: [{ householdId: null }, { householdId: household.id }] },
    })
    if (found === 0) return { status: 'ingredient_not_found' }
  }

  const date = parseLocalDate(input.date)
  const locale = resolveHouseholdLocale(household)
  const last = await prisma.dayExtra.aggregate({
    where: { householdId: household.id, date },
    _max: { position: true },
  })
  const row = await prisma.dayExtra.create({
    data: {
      householdId: household.id,
      date,
      ingredientId,
      label: 'label' in input ? input.label : null,
      quantity: 'quantity' in input ? (input.quantity ?? null) : null,
      position: (last._max.position ?? -1) + 1,
    },
    select: extraSelect(locale),
  })

  // Every outcome (created, reopened, exists) puts the name on the list.
  if ('label' in input) await addCustomShoppingItem(household, input.label)

  return { status: 'created', extra: toView(row, locale) }
}

export type UpdateDayExtraOutcome =
  { status: 'updated'; extra: DayExtraView } | { status: 'not_found' } | { status: 'free_text' }

/** Sets an ingredient extra's amount, or clears it with null. A free-text extra has no amount. */
export async function updateDayExtraQuantity(
  household: ExtrasHousehold,
  id: string,
  quantity: number | null,
): Promise<UpdateDayExtraOutcome> {
  const existing = await prisma.dayExtra.findFirst({
    where: { id, householdId: household.id },
    select: { label: true },
  })
  if (!existing) return { status: 'not_found' }
  if (existing.label !== null) return { status: 'free_text' }

  const locale = resolveHouseholdLocale(household)
  const row = await prisma.dayExtra.update({
    where: { id },
    data: { quantity },
    select: extraSelect(locale),
  })
  return { status: 'updated', extra: toView(row, locale) }
}

export async function deleteDayExtra(
  householdId: string,
  id: string,
): Promise<{ status: 'deleted' | 'not_found' }> {
  const { count } = await prisma.dayExtra.deleteMany({ where: { id, householdId } })
  return { status: count === 0 ? 'not_found' : 'deleted' }
}

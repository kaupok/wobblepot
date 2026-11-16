import { MAX_DAYS_AHEAD } from '@/lib/meal-planning/writable-days'

import {
  CHANGED_SOURCE_PROBLEMS,
  earliestSourceDate,
  type LeftoverSourceProblem,
  RECENT_MEALS_DAYS,
  sourceProblem,
} from '../recent-meals'
import { type DraftContext, type DraftView, fitKey } from './context'
import { type DraftItem, type DraftSlot, slotKey } from './schema'
import {
  addDays,
  draftDays,
  isPlaceholder,
  mainAt,
  type PlannedMain,
  plannedMealId,
  toSourceRow,
} from './view'

/**
 * The draft's rules (HON-1652). A problem names a slot `apply_plan` refuses
 * the whole draft for; a warning names slots the household may want to change,
 * and does not stop the write. Messages are plain sentences for the model.
 */

export type DraftProblemCode =
  | 'duplicateSlot'
  | 'outOfRange'
  | 'cooked'
  | 'mealNotFound'
  | 'unsuitable'
  | 'ruledOut'
  | 'itemNotFound'
  | Exclude<LeftoverSourceProblem, 'notFound'>
  | 'sourceReplaced'
  | 'duplicateSource'

export interface DraftProblem {
  date: string
  mealType: DraftSlot['mealType']
  code: DraftProblemCode
  message: string
}

export type DraftWarningCode = 'sameProteinInARow' | 'repeatedMeal' | 'losesChanges'

export interface DraftWarning {
  code: DraftWarningCode
  slots: { date: string; mealType: DraftSlot['mealType'] }[]
  message: string
}

const FIT_PROBLEMS = {
  notFound: {
    code: 'mealNotFound',
    message: 'No meal with this id. Use list_meals to find the meal.',
  },
  unsuitable: { code: 'unsuitable', message: 'This meal is not suitable for this meal type.' },
  ruledOut: {
    code: 'ruledOut',
    message: "This meal does not fit the household's diet, allergens or avoided ingredients.",
  },
} as const

const SOURCE_MESSAGES: Record<Exclude<LeftoverSourceProblem, 'notFound'>, string> = {
  notRecipe: 'Leftovers come from a recipe meal, not a fridge meal or a note.',
  side: "Leftovers come from a slot's main meal, not a side dish.",
  skipped: 'That meal is skipped, so there are no leftovers.',
  notBefore: 'Leftovers come from a meal in an earlier slot than this one.',
  tooOld: `Leftovers come from a meal no more than ${RECENT_MEALS_DAYS} days before this one.`,
  servingsRequired:
    'That meal is not cooked yet, so give servings: how much of it this meal takes.',
}

/** `restore`: the draft is `apply_plan`'s signed `previous` (`isRestore`). */
export function findProblems(
  ctx: DraftContext,
  view: DraftView,
  slots: readonly DraftSlot[],
  restore = false,
): DraftProblem[] {
  const problems: DraftProblem[] = []
  const seen = new Set<string>()

  for (const slot of slots) {
    const key = slotKey(slot)
    const add = (code: DraftProblemCode, message: string) =>
      problems.push({ date: slot.date, mealType: slot.mealType, code, message })

    if (seen.has(key)) {
      add('duplicateSlot', 'The draft names this slot more than once. Name each slot once.')
      continue
    }
    seen.add(key)

    if (slot.date < ctx.today || slot.date > ctx.lastDay) {
      add(
        'outOfRange',
        `A draft plans today up to ${MAX_DAYS_AHEAD} days ahead: ${ctx.today} to ${ctx.lastDay}. To log a past meal, use plan_meal.`,
      )
      continue
    }

    const stored = ctx.mains.get(key)
    if (stored?.status === 'completed') {
      add(
        'cooked',
        'This slot holds a cooked meal, so it cannot be changed. Leave it out of the draft.',
      )
      continue
    }

    if ('mealId' in slot) {
      const fit = ctx.fits.get(fitKey(slot.mealId, slot.mealType)) ?? 'notFound'
      if (fit !== 'allowed') add(FIT_PROBLEMS[fit].code, FIT_PROBLEMS[fit].message)
    }

    if ('items' in slot) {
      // A dinner once per lunch (HON-1441), whether named by id or by slot.
      const sources = new Set<string>()
      for (const item of slot.items) {
        const problem = itemProblem(ctx, view, slot, item, restore)
        if (problem) add(problem.code, problem.message)
        const source = sourceOf(ctx, view, item)
        if (source && sources.has(source)) {
          add(
            'duplicateSource',
            'Each meal can give leftovers once to a fridge meal. Name each source once.',
          )
        }
        if (source) sources.add(source)
      }
    }

    // Replacing the main deletes the lunches' links to it, so the draft must name them too.
    if (stored && !isPlaceholder(stored)) {
      const lunches = new Set(stored.leftoverItems.map((lunch) => slotKey(lunch)))
      for (const lunch of lunches) {
        if (view.named.has(lunch)) continue
        const [date, mealType] = lunch.split('|')
        add(
          'sourceReplaced',
          `The ${mealType} on ${date} takes leftovers from this meal. Add that ${mealType} to the draft too, with leftoverOf this slot or other items.`,
        )
      }
    }
  }
  return problems
}

function itemProblem(
  ctx: DraftContext,
  view: DraftView,
  slot: DraftSlot,
  item: DraftItem,
  restore: boolean,
): { code: DraftProblemCode; message: string } | null {
  const notFound = {
    code: 'itemNotFound' as const,
    message:
      'An item is not one this household can use. Use get_pantry for ingredient ids, and a slot with a recipe meal for leftovers.',
  }
  if ('ingredientId' in item) return ctx.ingredientIds.has(item.ingredientId) ? null : notFound
  if ('label' in item) return null

  let main: PlannedMain | null
  if ('sourceEntryId' in item) {
    const entry = ctx.stored.get(item.sourceEntryId)
    if (!entry) return notFound
    if (entry.mainEntryId === null && view.named.has(slotKey(entry))) {
      return {
        code: 'sourceReplaced',
        message: `The draft changes the ${entry.mealType} on ${entry.date}, which this item takes leftovers from. Use leftoverOf that slot instead of sourceEntryId.`,
      }
    }
    main = { from: 'kept', entry }
  } else {
    main = mainAt(ctx, view, slotKey(item.leftoverOf))
    if (!main) return notFound
  }

  const problem = sourceProblem(
    toSourceRow(main),
    item.servings,
    slot,
    earliestSourceDate(slot.date),
  )
  if (problem === null) return null
  if (restore && CHANGED_SOURCE_PROBLEMS.has(problem)) return null
  if (problem === 'notFound') return notFound
  return { code: problem, message: SOURCE_MESSAGES[problem] }
}

/** The entry a leftover item takes from: a stored id, or the draft slot's key. */
function sourceOf(ctx: DraftContext, view: DraftView, item: DraftItem): string | null {
  if ('sourceEntryId' in item) return item.sourceEntryId
  if (!('leftoverOf' in item)) return null
  const main = mainAt(ctx, view, slotKey(item.leftoverOf))
  return main?.from === 'kept' ? main.entry.id : slotKey(item.leftoverOf)
}

export function findWarnings(ctx: DraftContext, view: DraftView): DraftWarning[] {
  const warnings: DraftWarning[] = []
  const days = draftDays(view)
  const first = days[0]
  const last = days.at(-1)
  if (!first || !last) return warnings

  // Two dinners in a row with one protein, the draft's or a kept neighbour.
  const proteinOf = (date: string) => {
    const main = mainAt(ctx, view, slotKey({ date, mealType: 'dinner' }))
    if (main?.from === 'kept' && main.entry.status === 'skipped') return null
    const mealId = plannedMealId(main)
    if (!mealId) return null
    const protein =
      main?.from === 'kept'
        ? main.entry.meal?.primaryProteinType
        : ctx.meals.get(mealId)?.primaryProteinType
    return protein && protein !== 'none' ? protein : null
  }
  for (let day = addDays(first, -1); day <= last; day = addDays(day, 1)) {
    const next = addDays(day, 1)
    const protein = proteinOf(day)
    const isDrafted =
      view.named.has(slotKey({ date: day, mealType: 'dinner' })) ||
      view.named.has(slotKey({ date: next, mealType: 'dinner' }))
    if (protein && isDrafted && protein === proteinOf(next)) {
      warnings.push({
        code: 'sameProteinInARow',
        slots: [
          { date: day, mealType: 'dinner' },
          { date: next, mealType: 'dinner' },
        ],
        message: `The dinners on ${day} and ${next} both have ${protein} as their protein.`,
      })
    }
  }

  // One recipe as a main twice in the draft's days.
  const byMeal = new Map<string, { date: string; mealType: DraftSlot['mealType'] }[]>()
  for (const date of days) {
    for (const mealType of ['breakfast', 'lunch', 'dinner'] as const) {
      const main = mainAt(ctx, view, slotKey({ date, mealType }))
      if (main?.from === 'kept' && main.entry.status === 'skipped') continue
      const mealId = plannedMealId(main)
      if (mealId) byMeal.set(mealId, [...(byMeal.get(mealId) ?? []), { date, mealType }])
    }
  }
  for (const [mealId, repeats] of byMeal) {
    if (repeats.length < 2 || !repeats.some((slot) => view.named.has(slotKey(slot)))) continue
    const name =
      ctx.meals.get(mealId)?.name ??
      [...ctx.mains.values()].find((entry) => entry.mealId === mealId)?.meal?.name
    warnings.push({
      code: 'repeatedMeal',
      slots: repeats,
      message: `${name ?? 'One meal'} is planned ${repeats.length} times in these days.`,
    })
  }

  // What goes with a replaced meal.
  for (const [key, slot] of view.named) {
    const stored = ctx.mains.get(key)
    if (!stored || stored.status === 'completed') continue
    const lost = [
      stored.hasChanges && 'its Adjust recipe changes',
      stored.note !== null && 'its note',
      stored.sideCount > 0 && 'its sides',
    ].filter((part): part is string => Boolean(part))
    if (lost.length === 0) continue
    warnings.push({
      code: 'losesChanges',
      slots: [{ date: slot.date, mealType: slot.mealType }],
      message: `The draft replaces ${stored.meal?.name ?? 'the meal'} here, so ${lost.join(', ')} go with it. Undo does not bring them back.`,
    })
  }
  return warnings
}

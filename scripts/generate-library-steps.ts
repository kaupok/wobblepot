/**
 * Library preparation steps — deploy step and operator batch
 *
 * The signed-out home page shows three library meals a day and opens each in
 * the cook view, steps included. A public page must never call the AI, so the
 * steps are written ahead of time, here, into `MealPreparationSteps`: one row
 * per meal and locale, for the meal's own `servings`. The page only picks
 * meals that have a fresh row (`src/lib/landing/load-demo-day.ts`). The
 * migration workflows run this after the seed; by hand it fills a database
 * ahead of a deploy or past the per-run cap.
 *
 * Selects library meals (`householdId` null) with a ready illustration and a
 * hue — the ones the page can show — and for each locale writes the row that
 * is missing, or stale because the prompt inputs changed since (`inputHash`
 * no longer matches, see `stepsInputHash`). A rerun only picks up what is
 * needed, and a failed call is skipped, reported, and left for the next run.
 *
 * COSTS REAL MONEY with `--confirm` (about $0.02 per meal and locale). Spend
 * is printed, never ledgered: no household owns it.
 *
 *   pnpm steps:library                       # dry run: count and estimate
 *   pnpm steps:library --confirm             # write every missing or stale row
 *   pnpm steps:library --locale=et --limit=5 # one locale, first five
 *   pnpm steps:library --meal="Beef Bibimbap" --confirm
 *
 * Procedure: docs/DEPLOYMENT.md § "Library preparation steps".
 */

import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { STEPS_MODEL } from '../src/lib/ai/models'
import { buildFullStepsRequest } from '../src/lib/ai/preparation-steps'
import { estimateCostUsd } from '../src/lib/ai/pricing'
import { translateIngredient, translateMeal } from '../src/lib/i18n/content'
import { KNOWN_LOCALES, type Locale } from '../src/lib/i18n/locales'
import { stepsInputHash } from '../src/lib/landing/steps-input-hash'

/** Observed on the steps prompt: ~900 input and ~900 output tokens on Sonnet. */
export const STEPS_EST_USD = 0.02

export interface ParsedArgs {
  confirm: boolean
  locales: Locale[]
  /** A meal id or its English name; every selectable meal when absent. */
  meal?: string
  limit?: number
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { confirm: false, locales: [...KNOWN_LOCALES] }
  for (const arg of argv) {
    if (arg === '--confirm') args.confirm = true
    else if (arg.startsWith('--locale=')) {
      const wanted = arg.slice('--locale='.length).split(',').filter(Boolean)
      const unknown = wanted.filter((l) => !(KNOWN_LOCALES as readonly string[]).includes(l))
      if (unknown.length) throw new Error(`Unknown locale: ${unknown.join(', ')}`)
      args.locales = wanted as Locale[]
    } else if (arg.startsWith('--meal=')) args.meal = arg.slice('--meal='.length)
    else if (arg.startsWith('--limit=')) {
      const limit = Number(arg.slice('--limit='.length))
      if (!Number.isInteger(limit) || limit < 1) throw new Error(`Bad --limit: ${arg}`)
      args.limit = limit
    } else if (arg === '--help' || arg === '-h') {
      args.limit = 0
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
}

export interface StepsCandidate {
  id: string
  name: string
  /** The hash the prompt inputs give today, per locale (`stepsInputHash`). */
  inputHashes: Partial<Record<Locale, string>>
  preparationSteps: { locale: string; inputHash: string }[]
}

export interface StepsJob {
  mealId: string
  name: string
  locale: Locale
  reason: 'missing' | 'stale'
}

/** The (meal, locale) pairs with no row, or a row written from other inputs. */
export function selectWork(
  meals: readonly StepsCandidate[],
  locales: readonly Locale[],
): StepsJob[] {
  const jobs: StepsJob[] = []
  for (const meal of meals) {
    for (const locale of locales) {
      const row = meal.preparationSteps.find((r) => r.locale === locale)
      if (!row) jobs.push({ mealId: meal.id, name: meal.name, locale, reason: 'missing' })
      else if (row.inputHash !== meal.inputHashes[locale])
        jobs.push({ mealId: meal.id, name: meal.name, locale, reason: 'stale' })
    }
  }
  return jobs
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.limit === 0) {
    console.log(
      'Usage: pnpm steps:library [--confirm] [--locale=en,et] [--meal=<id|English name>] [--limit=N]',
    )
    return
  }

  const { prisma } = await import('../src/lib/prisma')
  const meals = await prisma.meal.findMany({
    where: {
      householdId: null,
      deletedAt: null,
      imageStatus: 'ready',
      imageHue: { not: null },
      ...(args.meal ? { OR: [{ id: args.meal }, { name: args.meal }] } : {}),
    },
    include: {
      translations: true,
      components: { include: { ingredient: { include: { translations: true } } } },
      preparationSteps: { select: { locale: true, inputHash: true } },
    },
    orderBy: { name: 'asc' },
  })

  // The prompt for one meal and locale, and the hash of its inputs.
  const requestFor = (meal: (typeof meals)[number], locale: Locale) => {
    const shown = translateMeal(meal, locale)
    const input = {
      mealName: shown.name,
      servings: meal.servings,
      timeMinutes: meal.timeMinutes,
      components: meal.components.map((comp) => ({
        name: translateIngredient(comp.ingredient, locale).name,
        quantityPerServing: comp.quantityPerServing,
        defaultUnit: comp.ingredient.defaultUnit,
      })),
      locale,
    }
    return { input, inputHash: stepsInputHash(input) }
  }
  const candidates = meals.map((meal) => ({
    id: meal.id,
    name: meal.name,
    inputHashes: Object.fromEntries(
      args.locales.map((locale) => [locale, requestFor(meal, locale).inputHash]),
    ),
    preparationSteps: meal.preparationSteps,
  }))

  const all = selectWork(candidates, args.locales)
  const jobs = args.limit ? all.slice(0, args.limit) : all
  console.log(
    `${meals.length} library meal(s) with an illustration; ${all.length} row(s) to write` +
      (jobs.length !== all.length ? `, ${jobs.length} selected` : '') +
      ` (~$${(jobs.length * STEPS_EST_USD).toFixed(2)}).`,
  )
  for (const job of jobs) console.log(`  ${job.reason.padEnd(7)} ${job.locale}  ${job.name}`)

  if (!args.confirm) {
    console.log('\nDry run. Add --confirm to write the rows above.')
    await prisma.$disconnect()
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const anthropic = createAnthropic({ apiKey })
  const byId = new Map(meals.map((meal) => [meal.id, meal]))
  let spent = 0
  let written = 0
  let failed = 0

  for (const job of jobs) {
    const meal = byId.get(job.mealId)
    if (!meal) continue
    const { input, inputHash } = requestFor(meal, job.locale)
    const request = buildFullStepsRequest(input)
    process.stdout.write(`${job.locale}  ${meal.name} … `)
    // One failed call (a timeout, an overloaded provider, a schema miss) is
    // reported and skipped: the rows before it stand, the ones after it still
    // get written, and this one is picked up again on the next run.
    let result: Awaited<ReturnType<typeof generateObject<typeof request.schema>>>
    try {
      result = await generateObject({
        ...request,
        model: anthropic(STEPS_MODEL),
        abortSignal: AbortSignal.timeout(60_000),
      })
    } catch (error) {
      failed++
      console.log(`failed: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const cost = estimateCostUsd({
      model: STEPS_MODEL,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    })
    spent += cost
    await prisma.mealPreparationSteps.upsert({
      where: { mealId_locale: { mealId: meal.id, locale: job.locale } },
      create: {
        mealId: meal.id,
        locale: job.locale,
        servings: meal.servings,
        steps: JSON.stringify(result.object),
        inputHash,
      },
      update: {
        servings: meal.servings,
        steps: JSON.stringify(result.object),
        inputHash,
      },
    })
    written++
    console.log(`${result.object.steps?.length ?? 0} steps ($${cost.toFixed(3)})`)
  }

  console.log(
    `\nWrote ${written} row(s)` +
      (failed ? `, ${failed} failed (rerun to retry)` : '') +
      `. Spent about $${spent.toFixed(2)}.`,
  )
  await prisma.$disconnect()
  // A warning in the workflow step, which continues on error, and a non-zero
  // exit for an operator; the rows that were written stay.
  if (failed) process.exitCode = 1
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

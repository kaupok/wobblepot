/**
 * AI Meal Selection Test Script
 *
 * Standalone script to test the AI meal selection flow without building UI.
 * Tests the complete generation pipeline: slot computation → candidate query →
 * AI selection → validation → deterministic repair.
 *
 * Usage: npx tsx scripts/test-ai-selection.ts [--dietary-type=omnivore|vegetarian|vegan|pescatarian]
 */

import 'dotenv/config'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { prisma } from '../src/lib/prisma'

// ============================================
// CONSTANTS
// ============================================

const MAX_TIME_MINUTES = 60
const CANDIDATE_POOL_LIMIT = 50

// ============================================
// TYPES
// ============================================

type DietaryType = 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian'
type ProteinType =
  | 'poultry'
  | 'beef'
  | 'pork'
  | 'lamb'
  | 'fish'
  | 'eggs'
  | 'legume'
  | 'dairy'
  | 'none'

interface SlotRequirement {
  date: Date
  proteinType: ProteinType
}

interface CandidateFilters {
  mealType: 'dinner'
  allergensToAvoid: string[]
  excludedIngredientIds: string[]
  recentMealIds: string[]
  primaryProteinType?: ProteinType
}

interface CandidateMeal {
  id: string
  name: string
  kidFriendly: boolean
  primaryProteinType: ProteinType
  mainIngredients: Array<{
    name: string
    category: string
  }>
}

interface PlanEntry {
  date: string
  mealId: string
}

interface HydratedPlanEntry {
  date: Date
  mealId: string
  meal: {
    id: string
    name: string
    primaryProteinType: ProteinType
    kidFriendly: boolean
  } | null
}

interface ValidationError {
  type: 'slot_violation' | 'consecutive_protein' | 'duplicate_meal' | 'invalid_meal'
  date?: Date
  dates?: Date[]
  expected?: ProteinType
  mealId?: string
}

interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

interface CandidatePools {
  fish: CandidateMeal[]
  legume: CandidateMeal[]
  any: CandidateMeal[]
}

// ============================================
// LOGGING UTILITIES
// ============================================

const log = {
  section: (title: string) => {
    console.log('\n' + '='.repeat(60))
    console.log(` ${title}`)
    console.log('='.repeat(60))
  },
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  success: (msg: string) => console.log(`[SUCCESS] ${msg}`),
  warn: (msg: string) => console.log(`[WARN] ${msg}`),
  error: (msg: string) => console.log(`[ERROR] ${msg}`),
  debug: (label: string, data: unknown) => {
    console.log(`[DEBUG] ${label}:`)
    console.log(JSON.stringify(data, null, 2))
  },
  table: (data: Array<Record<string, unknown>>) => {
    if (data.length === 0) {
      console.log('  (empty)')
      return
    }
    console.table(data)
  },
}

// ============================================
// DATE UTILITIES
// ============================================

function getWeekDates(startDate: Date): [Date, Date, Date, Date, Date, Date, Date] {
  const dates: Date[] = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + i)
    dates.push(date)
  }
  return dates as [Date, Date, Date, Date, Date, Date, Date]
}

function getNextMonday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayOfWeek = today.getDay()
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek
  today.setDate(today.getDate() + daysUntilMonday)
  return today
}

function formatDate(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${days[date.getDay()]} ${date.toISOString().split('T')[0]}`
}

type DayPosition = 'midweek' | 'weekend' | 'early' | 'late'

function pickDay(dates: [Date, Date, Date, Date, Date, Date, Date], position: DayPosition): Date {
  // All positions are relative to Monday start (index 0)
  // Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
  const positionMap: Record<DayPosition, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
    midweek: 2, // Wednesday
    weekend: 5, // Saturday
    early: 1, // Tuesday
    late: 4, // Friday
  }
  return dates[positionMap[position]]
}

// ============================================
// STEP 1: SLOT COMPUTATION
// ============================================

function computeRequiredSlots(
  dietaryType: DietaryType,
  dates: [Date, Date, Date, Date, Date, Date, Date]
): SlotRequirement[] {
  if (dietaryType === 'omnivore') {
    return [
      { date: pickDay(dates, 'midweek'), proteinType: 'fish' }, // fish 1x/week (Wed)
      { date: pickDay(dates, 'weekend'), proteinType: 'legume' }, // legume 1x/week (Sat)
    ]
  }
  if (dietaryType === 'pescatarian') {
    return [
      { date: pickDay(dates, 'early'), proteinType: 'fish' }, // fish 2x/week (Tue)
      { date: pickDay(dates, 'late'), proteinType: 'fish' }, // fish 2x/week (Fri)
      { date: pickDay(dates, 'midweek'), proteinType: 'legume' }, // legume 1x/week (Wed)
    ]
  }
  if (dietaryType === 'vegetarian' || dietaryType === 'vegan') {
    return [
      { date: pickDay(dates, 'early'), proteinType: 'legume' }, // legume 2x/week (Tue)
      { date: pickDay(dates, 'late'), proteinType: 'legume' }, // legume 2x/week (Fri)
    ]
  }
  return []
}

// ============================================
// STEP 2: CANDIDATE QUERY
// ============================================

async function getCandidates(filters: CandidateFilters): Promise<CandidateMeal[]> {
  // Build where clause dynamically
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereClause: any = {
    suitableFor: { has: filters.mealType },
    // Time constraint
    OR: [{ timeMinutes: { lte: MAX_TIME_MINUTES } }, { timeMinutes: null }],
    // Recent history
    id: { notIn: filters.recentMealIds },
  }

  // Add allergen filter if any
  if (filters.allergensToAvoid.length > 0) {
    whereClause.NOT = {
      components: {
        some: {
          ingredient: {
            allergens: { hasSome: filters.allergensToAvoid },
          },
        },
      },
    }
  }

  // Add excluded ingredients filter
  if (filters.excludedIngredientIds.length > 0) {
    whereClause.AND = [
      {
        NOT: {
          components: {
            some: { ingredientId: { in: filters.excludedIngredientIds } },
          },
        },
      },
    ]
  }

  // Add protein type filter for slot-specific queries
  if (filters.primaryProteinType) {
    whereClause.primaryProteinType = filters.primaryProteinType
  }

  const meals = await prisma.meal.findMany({
    where: whereClause,
    select: {
      id: true,
      name: true,
      kidFriendly: true,
      primaryProteinType: true,
      components: {
        orderBy: { quantityPerServing: 'desc' },
        take: 3,
        select: {
          ingredient: {
            select: { name: true, category: true },
          },
        },
      },
    },
  })

  return meals.map((m) => ({
    id: m.id,
    name: m.name,
    kidFriendly: m.kidFriendly,
    primaryProteinType: m.primaryProteinType as ProteinType,
    mainIngredients: m.components.map((c) => ({
      name: c.ingredient.name,
      category: c.ingredient.category,
    })),
  }))
}

function capPool(candidates: CandidateMeal[], limit = CANDIDATE_POOL_LIMIT): CandidateMeal[] {
  if (candidates.length <= limit) return candidates

  // Ensure mix of kidFriendly and adult meals
  const kidFriendly = candidates.filter((c) => c.kidFriendly)
  const adult = candidates.filter((c) => !c.kidFriendly)

  const result: CandidateMeal[] = []
  const halfLimit = Math.floor(limit / 2)

  // Add kid-friendly meals (up to half)
  result.push(...kidFriendly.slice(0, halfLimit))

  // Fill remaining with adult meals
  const remaining = limit - result.length
  result.push(...adult.slice(0, remaining))

  // If we still have space, add more kid-friendly
  if (result.length < limit && kidFriendly.length > halfLimit) {
    result.push(...kidFriendly.slice(halfLimit, halfLimit + (limit - result.length)))
  }

  return result
}

// ============================================
// STEP 3: AI SELECTION
// ============================================

const mealPlanSchema = z.object({
  entries: z.array(
    z.object({
      date: z.string().describe('Date in YYYY-MM-DD format'),
      mealId: z.string().describe('The meal ID from the candidates'),
    })
  ),
})

async function generateWithAI(
  requiredSlots: SlotRequirement[],
  remainingDates: Date[],
  candidatePools: CandidatePools,
  restrictions: string[] = [],
  previousErrors?: ValidationError[]
): Promise<PlanEntry[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required')
  }

  const anthropic = createAnthropic({ apiKey })

  // Format required slots
  const slotsText = requiredSlots
    .map((s) => {
      const pool = s.proteinType === 'fish' ? candidatePools.fish : candidatePools.legume
      return `- ${formatDate(s.date)}: MUST be ${s.proteinType.toUpperCase()} day
  Candidates: ${JSON.stringify(pool.map((c) => ({ id: c.id, name: c.name, proteinType: c.primaryProteinType })))}`
    })
    .join('\n')

  // Format remaining dates
  const remainingText = remainingDates.map(formatDate).join(', ')

  // Format any candidates
  const anyCandidatesText = JSON.stringify(
    candidatePools.any.map((c) => ({
      id: c.id,
      name: c.name,
      proteinType: c.primaryProteinType,
      kidFriendly: c.kidFriendly,
    }))
  )

  let prompt = `Select meals for this week's dinner plan.

REQUIRED SLOTS (must pick from specified candidates):
${slotsText}

REMAINING DAYS: ${remainingText}
Candidates: ${anyCandidatesText}

VARIETY RULES:
- No same proteinType on consecutive days
- Mix kid-friendly and adult meals
- Each meal can only be used once (no duplicates)
${restrictions.length > 0 ? `- Preferences (best effort): ${restrictions.join(', ')}` : ''}

Return exactly 7 entries, one for each day of the week.`

  if (previousErrors && previousErrors.length > 0) {
    prompt += `\n\nPREVIOUS ATTEMPT HAD ERRORS - please fix:
${previousErrors.map((e) => `- ${e.type}: ${JSON.stringify(e)}`).join('\n')}`
  }

  log.info('Calling AI with prompt...')
  log.debug('Prompt', prompt)

  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-20250514'),
    schema: mealPlanSchema,
    prompt,
  })

  return object.entries
}

// ============================================
// STEP 4: VALIDATION
// ============================================

async function hydratePlan(entries: PlanEntry[]): Promise<HydratedPlanEntry[]> {
  const mealIds = entries.map((e) => e.mealId)
  const meals = await prisma.meal.findMany({
    where: { id: { in: mealIds } },
    select: {
      id: true,
      name: true,
      primaryProteinType: true,
      kidFriendly: true,
    },
  })

  const mealMap = new Map(meals.map((m) => [m.id, m]))

  return entries.map((e) => {
    const meal = mealMap.get(e.mealId)
    return {
      date: new Date(e.date),
      mealId: e.mealId,
      meal: meal
        ? {
            id: meal.id,
            name: meal.name,
            primaryProteinType: meal.primaryProteinType as ProteinType,
            kidFriendly: meal.kidFriendly,
          }
        : null,
    }
  })
}

function validatePlan(
  plan: HydratedPlanEntry[],
  requiredSlots: SlotRequirement[]
): ValidationResult {
  const errors: ValidationError[] = []

  // Check for invalid meal IDs
  for (const entry of plan) {
    if (!entry.meal) {
      errors.push({ type: 'invalid_meal', date: entry.date, mealId: entry.mealId })
    }
  }

  // Check required slots
  for (const slot of requiredSlots) {
    const entry = plan.find(
      (e) => e.date.toISOString().split('T')[0] === slot.date.toISOString().split('T')[0]
    )
    if (!entry?.meal || entry.meal.primaryProteinType !== slot.proteinType) {
      errors.push({
        type: 'slot_violation',
        date: slot.date,
        expected: slot.proteinType,
      })
    }
  }

  // Check consecutive days
  const sorted = [...plan].sort((a, b) => a.date.getTime() - b.date.getTime())
  for (let i = 1; i < sorted.length; i++) {
    const currentEntry = sorted[i]
    const previousEntry = sorted[i - 1]
    const current = currentEntry?.meal?.primaryProteinType
    const previous = previousEntry?.meal?.primaryProteinType
    if (current && previous && current === previous && current !== 'none') {
      errors.push({
        type: 'consecutive_protein',
        dates: [previousEntry.date, currentEntry.date],
      })
    }
  }

  // Check duplicates
  const mealIds = plan.map((e) => e.mealId).filter(Boolean)
  if (new Set(mealIds).size !== mealIds.length) {
    errors.push({ type: 'duplicate_meal' })
  }

  return { valid: errors.length === 0, errors }
}

// ============================================
// STEP 5: DETERMINISTIC REPAIR
// ============================================

function repairPlan(
  plan: HydratedPlanEntry[],
  errors: ValidationError[],
  candidatePools: CandidatePools,
  requiredSlots: SlotRequirement[]
): HydratedPlanEntry[] {
  const repairedPlan = [...plan]
  const usedMealIds = new Set(plan.map((e) => e.mealId))

  for (const error of errors) {
    if (error.type === 'slot_violation' && error.date && error.expected) {
      const errorDate = error.date
      const entryIndex = repairedPlan.findIndex(
        (e) => e.date.toISOString().split('T')[0] === errorDate.toISOString().split('T')[0]
      )
      if (entryIndex === -1) continue

      const pool = error.expected === 'fish' ? candidatePools.fish : candidatePools.legume
      const replacement = findValidReplacement(
        repairedPlan,
        entryIndex,
        pool,
        usedMealIds,
        requiredSlots
      )

      if (replacement) {
        const currentEntry = repairedPlan[entryIndex]
        if (currentEntry) {
          usedMealIds.delete(currentEntry.mealId)
          repairedPlan[entryIndex] = {
            date: currentEntry.date,
            mealId: replacement.id,
            meal: {
              id: replacement.id,
              name: replacement.name,
              primaryProteinType: replacement.primaryProteinType,
              kidFriendly: replacement.kidFriendly,
            },
          }
          usedMealIds.add(replacement.id)
        }
      }
    }

    if (error.type === 'consecutive_protein' && error.dates && error.dates.length >= 2) {
      // Try to fix by replacing the second day
      const secondDate = error.dates[1]
      if (!secondDate) continue
      const secondDateStr = secondDate.toISOString().split('T')[0]
      const entryIndex = repairedPlan.findIndex(
        (e) => e.date.toISOString().split('T')[0] === secondDateStr
      )
      if (entryIndex === -1) continue

      const replacement = findValidReplacement(
        repairedPlan,
        entryIndex,
        candidatePools.any,
        usedMealIds,
        requiredSlots
      )

      if (replacement) {
        const currentEntry = repairedPlan[entryIndex]
        if (currentEntry) {
          usedMealIds.delete(currentEntry.mealId)
          repairedPlan[entryIndex] = {
            date: currentEntry.date,
            mealId: replacement.id,
            meal: {
              id: replacement.id,
              name: replacement.name,
              primaryProteinType: replacement.primaryProteinType,
              kidFriendly: replacement.kidFriendly,
            },
          }
          usedMealIds.add(replacement.id)
        }
      }
    }
  }

  return repairedPlan
}

function findValidReplacement(
  plan: HydratedPlanEntry[],
  entryIndex: number,
  pool: CandidateMeal[],
  usedMealIds: Set<string>,
  requiredSlots: SlotRequirement[]
): CandidateMeal | null {
  const sorted = [...plan].sort((a, b) => a.date.getTime() - b.date.getTime())
  const currentEntry = plan[entryIndex]
  if (!currentEntry) return null

  const currentDate = currentEntry.date.toISOString().split('T')[0]
  const sortedIndex = sorted.findIndex((e) => e.date.toISOString().split('T')[0] === currentDate)

  const prevEntry = sortedIndex > 0 ? sorted[sortedIndex - 1] : null
  const nextEntry = sortedIndex < sorted.length - 1 ? sorted[sortedIndex + 1] : null
  const prevProtein = prevEntry?.meal?.primaryProteinType ?? null
  const nextProtein = nextEntry?.meal?.primaryProteinType ?? null

  // Check if this is a required slot day
  const slotRequirement = requiredSlots.find(
    (s) => s.date.toISOString().split('T')[0] === currentDate
  )

  for (const candidate of pool) {
    // Skip if already used
    if (usedMealIds.has(candidate.id)) continue

    // Skip if matches previous day's protein
    if (prevProtein && candidate.primaryProteinType === prevProtein) continue

    // Skip if matches next day's protein
    if (nextProtein && candidate.primaryProteinType === nextProtein) continue

    // Skip if doesn't match slot requirement
    if (slotRequirement && candidate.primaryProteinType !== slotRequirement.proteinType) continue

    return candidate
  }

  return null
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2)
  const dietaryTypeArg = args.find((a) => a.startsWith('--dietary-type='))
  const dietaryType: DietaryType = (dietaryTypeArg?.split('=')[1] as DietaryType) || 'omnivore'

  log.section('AI MEAL SELECTION TEST')
  log.info(`Dietary type: ${dietaryType}`)
  log.info(`Date: ${new Date().toISOString()}`)

  // Check database connection
  log.section('DATABASE CHECK')
  const mealCount = await prisma.meal.count()
  const ingredientCount = await prisma.ingredient.count()
  log.info(`Meals in database: ${mealCount}`)
  log.info(`Ingredients in database: ${ingredientCount}`)

  if (mealCount === 0) {
    log.error('No meals in database. Run "pnpm db:seed" first.')
    process.exit(1)
  }

  // Step 1: Compute slots
  log.section('STEP 1: SLOT COMPUTATION')
  const startDate = getNextMonday()
  const dates = getWeekDates(startDate)
  log.info(`Plan week: ${formatDate(dates[0])} to ${formatDate(dates[6])}`)

  const requiredSlots = computeRequiredSlots(dietaryType, dates)
  log.info(`Required slots for ${dietaryType}:`)
  log.table(
    requiredSlots.map((s) => ({
      date: formatDate(s.date),
      proteinType: s.proteinType,
    }))
  )

  // Step 2: Query candidates
  log.section('STEP 2: CANDIDATE QUERY')
  const baseFilters: CandidateFilters = {
    mealType: 'dinner',
    allergensToAvoid: [],
    excludedIngredientIds: [],
    recentMealIds: [],
  }

  const candidatePools: CandidatePools = {
    fish: capPool(await getCandidates({ ...baseFilters, primaryProteinType: 'fish' })),
    legume: capPool(await getCandidates({ ...baseFilters, primaryProteinType: 'legume' })),
    any: capPool(await getCandidates(baseFilters)),
  }

  log.info(`Fish candidates: ${candidatePools.fish.length}`)
  log.info(`Legume candidates: ${candidatePools.legume.length}`)
  log.info(`Any candidates: ${candidatePools.any.length}`)

  // Check for empty pools
  for (const slot of requiredSlots) {
    const pool = slot.proteinType === 'fish' ? candidatePools.fish : candidatePools.legume
    if (pool.length === 0) {
      log.warn(`Empty pool for ${slot.proteinType} slot on ${formatDate(slot.date)}`)
    }
  }

  // Step 3: AI selection
  log.section('STEP 3: AI SELECTION')
  const remainingDates = dates.filter(
    (d) =>
      !requiredSlots.some(
        (s) => s.date.toISOString().split('T')[0] === d.toISOString().split('T')[0]
      )
  )

  let entries: PlanEntry[]
  try {
    entries = await generateWithAI(requiredSlots, remainingDates, candidatePools)
    log.success('AI generated meal selections')
    log.debug('AI Response', entries)
  } catch (error) {
    log.error(`AI generation failed: ${error}`)
    process.exit(1)
  }

  // Step 4: Hydrate and validate
  log.section('STEP 4: VALIDATION')
  let hydratedPlan = await hydratePlan(entries)
  let validation = validatePlan(hydratedPlan, requiredSlots)

  log.info(`Validation result: ${validation.valid ? 'PASSED' : 'FAILED'}`)
  if (!validation.valid) {
    log.warn('Validation errors:')
    for (const error of validation.errors) {
      log.warn(`  - ${error.type}: ${JSON.stringify(error)}`)
    }
  }

  // Step 5: Repair if needed
  if (!validation.valid) {
    log.section('STEP 5: DETERMINISTIC REPAIR')
    hydratedPlan = repairPlan(hydratedPlan, validation.errors, candidatePools, requiredSlots)
    validation = validatePlan(hydratedPlan, requiredSlots)

    log.info(`After repair: ${validation.valid ? 'PASSED' : 'FAILED'}`)
    if (!validation.valid) {
      log.warn('Remaining errors after repair:')
      for (const error of validation.errors) {
        log.warn(`  - ${error.type}: ${JSON.stringify(error)}`)
      }

      // Retry AI once
      log.section('STEP 5b: AI RETRY')
      try {
        entries = await generateWithAI(
          requiredSlots,
          remainingDates,
          candidatePools,
          [],
          validation.errors
        )
        hydratedPlan = await hydratePlan(entries)
        validation = validatePlan(hydratedPlan, requiredSlots)

        log.info(`After retry: ${validation.valid ? 'PASSED' : 'FAILED'}`)
      } catch (error) {
        log.error(`AI retry failed: ${error}`)
      }
    }
  }

  // Final output
  log.section('FINAL MEAL PLAN')
  const sortedPlan = [...hydratedPlan].sort((a, b) => a.date.getTime() - b.date.getTime())
  log.table(
    sortedPlan.map((e) => ({
      day: formatDate(e.date),
      meal: e.meal?.name || 'MISSING',
      proteinType: e.meal?.primaryProteinType || 'N/A',
      kidFriendly: e.meal?.kidFriendly ? 'Yes' : 'No',
    }))
  )

  // Summary statistics
  log.section('SUMMARY STATISTICS')
  const proteinCounts: Record<string, number> = {}
  let kidFriendlyCount = 0
  for (const entry of sortedPlan) {
    if (entry.meal) {
      const pt = entry.meal.primaryProteinType
      proteinCounts[pt] = (proteinCounts[pt] || 0) + 1
      if (entry.meal.kidFriendly) kidFriendlyCount++
    }
  }

  log.info('Protein type distribution:')
  log.table(Object.entries(proteinCounts).map(([type, count]) => ({ type, count })))
  log.info(`Kid-friendly meals: ${kidFriendlyCount}/7`)
  log.info(`Final validation: ${validation.valid ? 'PASSED' : 'FAILED'}`)

  if (validation.valid) {
    log.success('Meal plan generation completed successfully!')
  } else {
    log.error('Meal plan generation failed validation')
    process.exit(1)
  }
}

main()
  .catch((error) => {
    log.error(`Fatal error: ${error}`)
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

import { formatDateDisplay, toDateString } from '@/lib/meal-planning/dates'
import type { PromptInput, CandidatePools } from './types'
import type { MealSlot, SlotRequirement } from '@/lib/meal-planning/slots'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'
import type { MealType } from '@/generated/prisma/enums'

/**
 * Format a candidate pool for the AI prompt.
 * Only includes essential info to minimize token usage.
 */
function formatCandidates(
  candidates: CandidateMeal[],
): Array<{ id: string; name: string; proteinType: string; kidFriendly: boolean }> {
  return candidates.map((c) => ({
    id: c.id,
    name: c.name,
    proteinType: c.primaryProteinType,
    kidFriendly: c.kidFriendly,
  }))
}

/**
 * Format required slots section of the prompt.
 */
function formatRequiredSlots(slots: SlotRequirement[], pools: CandidatePools): string {
  if (slots.length === 0) {
    return 'No required protein slots for this dietary type.'
  }

  return slots
    .map((slot) => {
      const pool = slot.proteinType === 'fish' ? pools.fish : pools.legume
      const formattedCandidates = JSON.stringify(
        pool.map((c) => ({
          id: c.id,
          name: c.name,
          proteinType: c.primaryProteinType,
          kidFriendly: c.kidFriendly,
        })),
      )
      return `- ${formatDateDisplay(slot.date)} ${slot.mealType}: MUST be ${slot.proteinType.toUpperCase()}
  Candidates: ${formattedCandidates}`
    })
    .join('\n')
}

/**
 * Format remaining slots section grouped by meal type.
 */
function formatRemainingSlots(
  slots: MealSlot[],
  candidatesByMealType: Map<MealType, CandidateMeal[]>,
  dinnerPool: CandidateMeal[],
): string {
  if (slots.length === 0) {
    return 'No additional slots to fill.'
  }

  // Group remaining slots by meal type
  const slotsByMealType = new Map<MealType, MealSlot[]>()
  for (const slot of slots) {
    const existing = slotsByMealType.get(slot.mealType) ?? []
    existing.push(slot)
    slotsByMealType.set(slot.mealType, existing)
  }

  const sections: string[] = []

  for (const [mealType, mealSlots] of slotsByMealType) {
    const dates = mealSlots.map((s) => formatDateDisplay(s.date)).join(', ')
    // For dinner, use the "any" pool (which is dinner candidates)
    // For other meal types, use their specific pool
    const candidates =
      mealType === 'dinner' ? dinnerPool : (candidatesByMealType.get(mealType) ?? [])
    const candidatesText = JSON.stringify(formatCandidates(candidates))

    sections.push(`${mealType.toUpperCase()} slots: ${dates}
Candidates: ${candidatesText}`)
  }

  return sections.join('\n\n')
}

/**
 * Compute the actual first date from required slots and remaining slots.
 * For partial weeks, this may be later than startDate.
 */
function getFirstEntryDate(
  requiredSlots: SlotRequirement[],
  remainingSlots: MealSlot[],
): Date | null {
  const slotDates = requiredSlots.map((s) => s.date)
  const remainingDates = remainingSlots.map((s) => s.date)
  const allDates = [...slotDates, ...remainingDates]

  if (allDates.length === 0) return null

  return allDates.reduce((earliest, d) => (d < earliest ? d : earliest))
}

/**
 * Build the complete prompt for AI meal plan generation.
 */
export function buildMealPlanPrompt(
  input: PromptInput & { candidatesByMealType?: Map<MealType, CandidateMeal[]> },
): string {
  const {
    endDate,
    totalEntries,
    requiredSlots,
    remainingSlots,
    candidatePools,
    restrictions,
    candidatesByMealType,
  } = input

  // Calculate last day (endDate is exclusive, so subtract 1 day)
  const lastDay = new Date(endDate)
  lastDay.setDate(lastDay.getDate() - 1)

  // Get the actual first date (may differ from startDate for partial weeks)
  const firstEntryDate = getFirstEntryDate(requiredSlots, remainingSlots) ?? lastDay

  const slotsText = formatRequiredSlots(requiredSlots, candidatePools)
  const remainingText = formatRemainingSlots(
    remainingSlots,
    candidatesByMealType ?? new Map(),
    candidatePools.any,
  )

  // Collect all meal types being planned
  const allMealTypes = new Set<MealType>()
  for (const slot of requiredSlots) {
    allMealTypes.add(slot.mealType)
  }
  for (const slot of remainingSlots) {
    allMealTypes.add(slot.mealType)
  }
  const mealTypesStr = [...allMealTypes].join(', ')

  let prompt = `Select meals for this week's meal plan (${mealTypesStr}).

REQUIRED PROTEIN SLOTS (must pick from specified candidates):
${slotsText}

REMAINING SLOTS:
${remainingText}

VARIETY RULES:
- No same proteinType on consecutive days for the same meal type
- Mix kid-friendly and adult meals
- Each meal can only be used once across all slots (no duplicates)`

  if (restrictions.length > 0) {
    prompt += `\n- Dietary preferences (best effort): ${restrictions.join(', ')}`
  }

  prompt += `

Return exactly ${totalEntries} entries covering ${toDateString(firstEntryDate)} through ${toDateString(lastDay)}.
Each entry must include: date (YYYY-MM-DD format), mealType (breakfast/lunch/dinner), and mealId.`

  return prompt
}

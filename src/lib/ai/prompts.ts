import { formatDateDisplay, toDateString } from '@/lib/meal-planning/dates'
import type { PromptInput, CandidatePools } from './types'
import type { SlotRequirement } from '@/lib/meal-planning/slots'

/**
 * Format a candidate pool for the AI prompt.
 * Only includes essential info to minimize token usage.
 */
function formatCandidates(
  candidates: CandidatePools['any'],
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
      return `- ${formatDateDisplay(slot.date)}: MUST be ${slot.proteinType.toUpperCase()} day
  Candidates: ${formattedCandidates}`
    })
    .join('\n')
}

/**
 * Compute the actual first date from required slots and remaining dates.
 * For partial weeks, this may be later than startDate.
 */
function getFirstEntryDate(requiredSlots: SlotRequirement[], remainingDates: Date[]): Date | null {
  const slotDates = requiredSlots.map((s) => s.date)
  const allDates = [...slotDates, ...remainingDates]

  if (allDates.length === 0) return null

  return allDates.reduce((earliest, d) => (d < earliest ? d : earliest))
}

/**
 * Build the complete prompt for AI meal plan generation.
 */
export function buildMealPlanPrompt(input: PromptInput): string {
  const { endDate, totalEntries, requiredSlots, remainingDates, candidatePools, restrictions } =
    input

  // Calculate last day (endDate is exclusive, so subtract 1 day)
  const lastDay = new Date(endDate)
  lastDay.setDate(lastDay.getDate() - 1)

  // Get the actual first date (may differ from startDate for partial weeks)
  const firstEntryDate = getFirstEntryDate(requiredSlots, remainingDates) ?? lastDay

  const slotsText = formatRequiredSlots(requiredSlots, candidatePools)
  const remainingText = remainingDates.map(formatDateDisplay).join(', ')
  const anyCandidatesText = JSON.stringify(formatCandidates(candidatePools.any))

  let prompt = `Select meals for this week's dinner plan.

REQUIRED SLOTS (must pick from specified candidates):
${slotsText}

REMAINING DAYS: ${remainingText}
Candidates: ${anyCandidatesText}

VARIETY RULES:
- No same proteinType on consecutive days
- Mix kid-friendly and adult meals
- Each meal can only be used once (no duplicates)`

  if (restrictions.length > 0) {
    prompt += `\n- Dietary preferences (best effort): ${restrictions.join(', ')}`
  }

  prompt += `

Return exactly ${totalEntries} entries covering ${toDateString(firstEntryDate)} through ${toDateString(lastDay)}.
Use YYYY-MM-DD format for dates.`

  return prompt
}

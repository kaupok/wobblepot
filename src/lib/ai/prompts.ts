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
 * Build the complete prompt for AI meal plan generation.
 */
export function buildMealPlanPrompt(input: PromptInput): string {
  const { startDate, requiredSlots, remainingDates, candidatePools, restrictions } = input

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

Return exactly 7 entries, one for each day of the week.
Use YYYY-MM-DD format for dates (${toDateString(startDate)} style).`

  return prompt
}

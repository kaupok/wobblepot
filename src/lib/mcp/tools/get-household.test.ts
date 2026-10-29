import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/household/members', () => ({ listMembersForAssistant: vi.fn() }))
vi.mock('@/lib/household/excluded-ingredients', () => ({ matchExcludedIngredients: vi.fn() }))

import { matchExcludedIngredients } from '@/lib/household/excluded-ingredients'
import { listMembersForAssistant } from '@/lib/household/members'
import { type McpHousehold, NO_HOUSEHOLD_MESSAGE, runTool } from '@/lib/mcp/context'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'

import { getHousehold } from './get-household'

const household = mcpHousehold({
  id: 'household-1',
  name: 'The Tamms',
  timezone: 'Europe/Tallinn',
  // The full row, with the column the tool must not report.
  aiCapUsd: 5,
  preferences: {
    id: 'prefs-1',
    householdId: 'household-1',
    dietaryType: 'pescatarian',
    allergensToAvoid: ['nuts', 'gluten'],
    restrictions: ['halal', 'low sodium'],
    excludedIngredients: ['mushroom', 'durian'],
    excludedIngredientIds: ['ing-shiitake'],
    weekdayMealTypes: ['dinner'],
    weekendMealTypes: ['breakfast', 'lunch', 'dinner'],
  },
} as unknown as Partial<McpHousehold>)
const ctx = { userId: 'user-1', household, scopes: READ_SCOPES }

const MEMBERS = [
  { name: 'Mari', linked: true, portionMultiplier: 1 },
  { name: 'Jaan', linked: true, portionMultiplier: 1 },
  { name: 'Liis', linked: false, portionMultiplier: 0.5 },
]

describe('get_household', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listMembersForAssistant).mockResolvedValue(MEMBERS)
    vi.mocked(matchExcludedIngredients).mockResolvedValue([
      {
        tag: 'mushroom',
        ingredients: [
          { id: 'ing-mushroom', name: 'Mushroom' },
          { id: 'ing-shiitake', name: 'Shiitake mushrooms' },
        ],
      },
      { tag: 'durian', ingredients: [] },
    ])
  })

  it("returns the household's rules, members, servings and what each rule controls", async () => {
    const result = await runTool(getHousehold, ctx, {})

    expect(listMembersForAssistant).toHaveBeenCalledWith('household-1')
    expect(matchExcludedIngredients).toHaveBeenCalledWith('household-1', ['mushroom', 'durian'])
    expect(result.structuredContent).toEqual({
      household: {
        name: 'The Tamms',
        timezone: 'Europe/Tallinn',
        weekdayMealTypes: ['dinner'],
        weekendMealTypes: ['breakfast', 'lunch', 'dinner'],
        dietaryType: 'pescatarian',
        allergensToAvoid: ['nuts', 'gluten'],
        restrictions: ['halal', 'low sodium'],
        ingredientsToAvoid: [
          { name: 'mushroom', excludes: ['Mushroom', 'Shiitake mushrooms'], note: null },
          {
            name: 'durian',
            excludes: [],
            note: 'Matches no ingredient, so it excludes no meal.',
          },
        ],
      },
      members: [
        { name: 'Mari', linked: true, portionMultiplier: 1 },
        { name: 'Jaan', linked: true, portionMultiplier: 1 },
        { name: 'Liis', linked: false, portionMultiplier: 0.5 },
      ],
      // Two adults at 1 and a child at 0.5.
      servings: {
        default: 2.5,
        rule: "The sum of the members' portion sizes, rounded to the nearest 0.5, at least 1. A planned entry's own servings, when set, win.",
      },
      rules: {
        filters:
          'allergensToAvoid and ingredientsToAvoid filter list_meals, plan_meal, swap_meal and plan generation; dietaryType filters plan_meal, swap_meal and plan generation but not list_meals, so check a listed meal against the diet yourself. A meal that breaks a filter is left out or refused.',
        notesForAi:
          'restrictions ("Notes for the AI" on the settings page) goes to the AI prompt in four features: plan generation, Imagine, Adjust recipe (adjust_meal) and the cook question. list_meals, plan_meal and swap_meal ignore it, so check these notes yourself before you plan or suggest a meal.',
      },
    })
    expect(getHousehold.outputSchema.safeParse(result.structuredContent).success).toBe(true)
  })

  it('returns exactly the meal-planning keys: no email, reminder, invite, token or cost cap', async () => {
    const result = await runTool(getHousehold, ctx, {})
    // A cast, not `outputSchema.parse`, which would strip an extra key.
    const output = result.structuredContent as z.infer<typeof getHousehold.outputSchema>

    expect(Object.keys(output).sort()).toEqual(['household', 'members', 'rules', 'servings'])
    expect(Object.keys(output.household).sort()).toEqual([
      'allergensToAvoid',
      'dietaryType',
      'ingredientsToAvoid',
      'name',
      'restrictions',
      'timezone',
      'weekdayMealTypes',
      'weekendMealTypes',
    ])
    for (const member of output.members) {
      expect(Object.keys(member).sort()).toEqual(['linked', 'name', 'portionMultiplier'])
    }
    expect(Object.keys(output.servings).sort()).toEqual(['default', 'rule'])
    expect(Object.keys(output.rules).sort()).toEqual(['filters', 'notesForAi'])
    expect(JSON.stringify(output)).not.toMatch(/email|reminder|invite|token|aiCap/i)
  })

  it('answers a household with no saved preferences with the column defaults', async () => {
    vi.mocked(matchExcludedIngredients).mockResolvedValue([])
    vi.mocked(listMembersForAssistant).mockResolvedValue([
      { name: 'Mari', linked: true, portionMultiplier: 1 },
    ])

    const result = await runTool(getHousehold, { ...ctx, household: mcpHousehold() }, {})

    expect(matchExcludedIngredients).toHaveBeenCalledWith('household-1', [])
    expect(result.structuredContent).toMatchObject({
      household: {
        weekdayMealTypes: ['dinner'],
        weekendMealTypes: ['dinner'],
        dietaryType: null,
        allergensToAvoid: [],
        restrictions: [],
        ingredientsToAvoid: [],
      },
      servings: { default: 1 },
    })
  })

  it('answers a read-only token', async () => {
    const result = await runTool(getHousehold, ctx, {})

    expect(result.isError).toBeUndefined()
    expect(getHousehold.annotations).toBeUndefined()
  })

  it('answers with the onboarding message without a household', async () => {
    const result = await runTool(
      getHousehold,
      { userId: 'user-1', household: null, scopes: READ_SCOPES },
      {},
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: NO_HOUSEHOLD_MESSAGE }],
    })
    expect(listMembersForAssistant).not.toHaveBeenCalled()
  })
})

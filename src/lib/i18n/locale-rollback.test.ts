import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getSession, getCachedMembership } from '@/lib/session'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import {
  englishVoiceForPrepSteps,
  estonianVoiceForPrepSteps,
  localeInstruction,
} from '@/lib/ai/prompts'
import { getLocale } from './get-locale'
import { resolveHouseholdLocale } from './resolve-locale'

/**
 * The rollback lever (docs/LOCALIZATION.md): removing a locale from
 * `KNOWN_LOCALES` must revert every household still storing it to English
 * chrome, English content names and English AI prompts (HON-921). This pulls
 * the lever for real: `KNOWN_LOCALES` is `['en']` here, the household still
 * stores `'et'`, the browser asks for Estonian, and the `et` translation rows
 * are present, so any path that skipped the guard would visibly apply them.
 */

vi.mock('@/lib/i18n/locales', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./locales')>()
  const { z } = await import('zod')
  const KNOWN_LOCALES = ['en'] as const
  return {
    ...actual,
    KNOWN_LOCALES,
    PUBLIC_LOCALES: KNOWN_LOCALES,
    LocaleSchema: z.enum(KNOWN_LOCALES),
    isKnownLocale: (value: string) => (KNOWN_LOCALES as readonly string[]).includes(value),
    isPublicLocale: (value: string) => (KNOWN_LOCALES as readonly string[]).includes(value),
  }
})

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'accept-language': 'et' })),
}))

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
  getCachedMembership: vi.fn(),
}))

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pantryItem: { findMany: vi.fn() },
    mealPlan: { findUnique: vi.fn() },
    mealPlanEntry: { findMany: vi.fn() },
  },
}))

const ROLLED_BACK = { id: 'household-1', locale: 'et', timezone: 'Europe/Tallinn' }

const onion = {
  id: 'ing-1',
  name: 'onion',
  category: 'vegetable',
  defaultUnit: 'g',
  gramsPerPiece: null,
  translations: [{ locale: 'et', name: 'sibul' }],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('locale rollback', () => {
  it('resolves the household to the default locale', () => {
    expect(resolveHouseholdLocale(ROLLED_BACK)).toBe('en')
  })

  it('renders English chrome even when the browser asks for a known locale', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { id: 'user-1' } } as Awaited<
      ReturnType<typeof getSession>
    >)
    vi.mocked(getCachedMembership).mockResolvedValue({
      householdId: ROLLED_BACK.id,
      household: { locale: ROLLED_BACK.locale },
    } as Awaited<ReturnType<typeof getCachedMembership>>)

    expect(await getLocale()).toBe('en')
  })

  it('loads the pantry with English names and no translation join', async () => {
    vi.mocked(prisma.pantryItem.findMany).mockResolvedValue([
      {
        id: 'p-1',
        ingredientId: onion.id,
        ingredient: onion,
        quantity: 1,
        isStaple: false,
        updatedAt: new Date('2026-10-01T00:00:00Z'),
      },
    ] as never)

    const { items } = await loadPantry({ ...ROLLED_BACK, members: [] }, { days: null })

    expect(items.map((i) => i.ingredient.name)).toEqual(['onion'])
    const select = vi.mocked(prisma.pantryItem.findMany).mock.calls[0]![0]!.include!.ingredient as {
      select: Record<string, unknown>
    }
    expect(select.select).not.toHaveProperty('translations')
  })

  it('loads plan entries with English meal and ingredient names and no translation join', async () => {
    vi.mocked(prisma.mealPlan.findUnique).mockResolvedValue({ id: 'plan-1' } as never)
    vi.mocked(prisma.mealPlanEntry.findMany).mockResolvedValue([
      {
        id: 'entry-1',
        date: new Date('2026-10-02T00:00:00Z'),
        mealType: 'dinner',
        status: 'planned',
        rating: null,
        preparationTips: null,
        note: null,
        servingOverride: null,
        pantryDeductedAt: null,
        meal: {
          id: 'meal-1',
          name: 'Onion soup',
          description: 'Warm and sweet',
          preparationNotes: 'Cook the onions slowly',
          kidFriendly: true,
          timeMinutes: 40,
          primaryProteinType: null,
          householdId: null,
          imageUrl: null,
          imageColor: null,
          imagePromptVersion: null,
          translations: [
            {
              locale: 'et',
              name: 'Sibulasupp',
              description: 'Soe ja magus',
              preparationNotes: 'Hauta sibulat aeglaselt',
            },
          ],
          components: [
            {
              ingredientId: onion.id,
              quantityPerServing: 100,
              isVague: false,
              originalPhrase: null,
              ingredient: onion,
            },
          ],
        },
      },
    ] as never)

    const { entries } = await loadPlanEntries(
      { ...ROLLED_BACK, _count: { members: 1 }, members: [] },
      {
        startDate: new Date('2026-10-01T00:00:00Z'),
        endDate: new Date('2026-10-08T00:00:00Z'),
      },
    )

    const meal = entries[0]!.meal!
    expect(meal.name).toBe('Onion soup')
    expect(meal.description).toBe('Warm and sweet')
    expect(meal.preparationNotes).toBe('Cook the onions slowly')
    expect(meal.components.map((c) => c.ingredient.name)).toEqual(['onion'])

    const include = vi.mocked(prisma.mealPlanEntry.findMany).mock.calls[0]![0]!.include!.meal as {
      include: Record<string, unknown>
    }
    expect(include.include).not.toHaveProperty('translations')
  })

  it('builds English AI prompts: no locale instruction and no Estonian voice', () => {
    const locale = resolveHouseholdLocale(ROLLED_BACK)
    expect(localeInstruction(locale)).toBe('')
    expect(estonianVoiceForPrepSteps(locale)).toBe('')
    // A caller that skipped the helper and passed the stored 'et' still gets
    // English: both helpers check KNOWN_LOCALES themselves.
    expect(localeInstruction(ROLLED_BACK.locale)).toBe('')
    expect(estonianVoiceForPrepSteps(ROLLED_BACK.locale)).toBe('')
    // English output gets the English voice rules (HON-963).
    expect(englishVoiceForPrepSteps(ROLLED_BACK.locale)).toContain('ENGLISH VOICE')
  })
})

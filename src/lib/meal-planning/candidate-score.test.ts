import { describe, it, expect } from 'vitest'
import {
  SCORE_JITTER_RANGE,
  SIMILARITY_WEIGHTS,
  SIMILAR_PREP_TIME_MINUTES,
  SLOT_FIT_WEIGHTS,
  scoreCandidate,
  scoreJitter,
  type ScorableCandidate,
} from './candidate-score'
import type { ProteinType } from '@/generated/prisma/enums'

interface PoolMeal extends ScorableCandidate {
  id: string
  timeMinutes: number | null
}

function meal(id: string, overrides: Partial<PoolMeal> = {}): PoolMeal {
  return {
    id,
    kidFriendly: false,
    primaryProteinType: 'poultry' as ProteinType,
    topIngredients: [],
    isFavorite: false,
    isCustom: false,
    timeMinutes: 30,
    ...overrides,
  }
}

/**
 * One fixed pool, ranked by both profiles. The point of pinning the same pool twice is
 * that the two profiles put different meals on top — which is the behaviour the separate
 * weight profiles exist to express.
 */
const POOL: PoolMeal[] = [
  meal('plain'),
  meal('favorite', { isFavorite: true }),
  meal('custom-kid', { isCustom: true, kidFriendly: true }),
  meal('pantry-match', { topIngredients: [{ name: 'rice' }, { name: 'egg' }] }),
  meal('same-protein-quick', { primaryProteinType: 'fish' as ProteinType, timeMinutes: 35 }),
]

const PANTRY = new Set(['rice', 'egg'])

/** Rank without jitter, so the assertion is on the weights alone. */
function rank(
  pool: PoolMeal[],
  weights: typeof SLOT_FIT_WEIGHTS,
  context: Parameters<typeof scoreCandidate>[2] = {},
): string[] {
  return pool
    .map((m) => ({
      id: m.id,
      score: scoreCandidate(m, weights, { ...context, timeMinutes: m.timeMinutes }),
    }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.id)
}

describe('scoreCandidate', () => {
  describe('slot fit profile', () => {
    it('ranks a fixed pool by household preference', () => {
      const ranked = rank(POOL, SLOT_FIT_WEIGHTS, { pantryIngredientNames: PANTRY })

      // favourite 3 > custom 2 + kid-friendly 1 is a tie at 3, broken by pool order;
      // pantry 2 × 0.5 = 1 follows, then the two unscored meals.
      expect(ranked.slice(0, 3)).toEqual(['favorite', 'custom-kid', 'pantry-match'])
    })

    it('ignores the current meal, since an empty slot has none', () => {
      const withReference = rank(POOL, SLOT_FIT_WEIGHTS, {
        currentProteinType: 'fish' as ProteinType,
        currentTimeMinutes: 30,
      })
      const withoutReference = rank(POOL, SLOT_FIT_WEIGHTS)

      expect(withReference).toEqual(withoutReference)
    })

    it('scores each signal at its profile weight', () => {
      expect(scoreCandidate(meal('m', { isFavorite: true }), SLOT_FIT_WEIGHTS)).toBe(3)
      expect(scoreCandidate(meal('m', { isCustom: true }), SLOT_FIT_WEIGHTS)).toBe(2)
      expect(scoreCandidate(meal('m', { kidFriendly: true }), SLOT_FIT_WEIGHTS)).toBe(1)
      expect(
        scoreCandidate(meal('m', { topIngredients: [{ name: 'rice' }] }), SLOT_FIT_WEIGHTS, {
          pantryIngredientNames: PANTRY,
        }),
      ).toBe(0.5)
    })
  })

  describe('similarity profile', () => {
    const context = {
      currentProteinType: 'fish' as ProteinType,
      currentTimeMinutes: 30,
      pantryIngredientNames: PANTRY,
    }

    it('ranks the same pool by resemblance to the meal being replaced', () => {
      const ranked = rank(POOL, SIMILARITY_WEIGHTS, context)

      // Every meal here is within the prep-time window, so that +2 is common to all of
      // them: same-protein 3 + 2 = 5, favourite 2 + 2 = 4, custom 1 + kid-friendly 0.5
      // + 2 = 3.5, pantry 2 × 0.5 + 2 = 3, plain 2.
      expect(ranked.slice(0, 3)).toEqual(['same-protein-quick', 'favorite', 'custom-kid'])
    })

    it('puts a different meal on top than slot fit does, for the same pool', () => {
      expect(rank(POOL, SIMILARITY_WEIGHTS, context)[0]).not.toBe(
        rank(POOL, SLOT_FIT_WEIGHTS, { pantryIngredientNames: PANTRY })[0],
      )
    })

    it('scores each signal at its profile weight', () => {
      expect(scoreCandidate(meal('m', { isFavorite: true }), SIMILARITY_WEIGHTS)).toBe(2)
      expect(scoreCandidate(meal('m', { isCustom: true }), SIMILARITY_WEIGHTS)).toBe(1)
      expect(scoreCandidate(meal('m', { kidFriendly: true }), SIMILARITY_WEIGHTS)).toBe(0.5)
      expect(
        scoreCandidate(meal('m', { topIngredients: [{ name: 'rice' }] }), SIMILARITY_WEIGHTS, {
          pantryIngredientNames: PANTRY,
        }),
      ).toBe(0.5)
    })

    it('awards the prep-time bonus only inside the similarity window', () => {
      const inside = scoreCandidate(meal('m'), SIMILARITY_WEIGHTS, {
        timeMinutes: 30 + SIMILAR_PREP_TIME_MINUTES,
        currentTimeMinutes: 30,
      })
      const outside = scoreCandidate(meal('m'), SIMILARITY_WEIGHTS, {
        timeMinutes: 30 + SIMILAR_PREP_TIME_MINUTES + 1,
        currentTimeMinutes: 30,
      })

      expect(inside).toBe(SIMILARITY_WEIGHTS.similarPrepTime)
      expect(outside).toBe(0)
    })

    it('awards the protein bonus only on a match', () => {
      const match = scoreCandidate(
        meal('m', { primaryProteinType: 'fish' as ProteinType }),
        SIMILARITY_WEIGHTS,
        {
          currentProteinType: 'fish' as ProteinType,
        },
      )
      const miss = scoreCandidate(
        meal('m', { primaryProteinType: 'beef' as ProteinType }),
        SIMILARITY_WEIGHTS,
        {
          currentProteinType: 'fish' as ProteinType,
        },
      )

      expect(match).toBe(SIMILARITY_WEIGHTS.sameProteinType)
      expect(miss).toBe(0)
    })
  })

  it('adds a pantry point per matching ingredient', () => {
    const score = scoreCandidate(
      meal('m', { topIngredients: [{ name: 'rice' }, { name: 'egg' }, { name: 'saffron' }] }),
      SLOT_FIT_WEIGHTS,
      { pantryIngredientNames: PANTRY },
    )

    expect(score).toBe(2 * SLOT_FIT_WEIGHTS.pantryMatchPerIngredient)
  })

  it('scores an empty pantry as no signal rather than a penalty', () => {
    const candidate = meal('m', { topIngredients: [{ name: 'rice' }] })

    expect(scoreCandidate(candidate, SLOT_FIT_WEIGHTS, { pantryIngredientNames: new Set() })).toBe(
      0,
    )
    expect(scoreCandidate(candidate, SLOT_FIT_WEIGHTS)).toBe(0)
  })
})

describe('scoreJitter', () => {
  const seed = { entryId: 'entry-1', dateString: '2026-09-21', candidateId: 'meal-1' }

  it('returns the same value for the same seed', () => {
    expect(scoreJitter(seed)).toBe(scoreJitter(seed))
  })

  it('varies between entries, so two slots do not rank identically', () => {
    expect(scoreJitter({ ...seed, entryId: 'entry-2' })).not.toBe(scoreJitter(seed))
  })

  it('varies between candidates, so a tied pool still gets shuffled', () => {
    expect(scoreJitter({ ...seed, candidateId: 'meal-2' })).not.toBe(scoreJitter(seed))
  })

  it('varies between dates, so the same slot rotates from one day to the next', () => {
    expect(scoreJitter({ ...seed, dateString: '2026-09-22' })).not.toBe(scoreJitter(seed))
  })

  it('stays inside [0, SCORE_JITTER_RANGE) so it can only break ties', () => {
    for (let i = 0; i < 500; i++) {
      const value = scoreJitter({ ...seed, candidateId: `meal-${i}` })
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(SCORE_JITTER_RANGE)
    }
  })

  it('is bounded by the smallest weight in either profile', () => {
    // The whole safety argument for the jitter is that it cannot outrun one signal. The
    // smallest weight in either profile is pantryMatchPerIngredient (0.5), so assert the
    // constant against it directly — a single seed pair cannot, since any one pair holds for
    // a far larger range by luck of the draw.
    const smallestWeight = Math.min(
      ...[SLOT_FIT_WEIGHTS, SIMILARITY_WEIGHTS].flatMap((w) =>
        Object.values(w).filter((weight) => weight > 0),
      ),
    )

    expect(SCORE_JITTER_RANGE).toBeLessThanOrEqual(smallestWeight)
  })

  it('never lifts a candidate past one that scored the smallest signal, for any seed', () => {
    // 500 pairs, not one: at SCORE_JITTER_RANGE = 0.75 this fails on 29 of them and at 1.0 on
    // 69, so it actually pins the constant rather than passing on a lucky draw.
    for (let i = 0; i < 500; i++) {
      const lower =
        scoreCandidate(meal('a'), SLOT_FIT_WEIGHTS) +
        scoreJitter({ ...seed, candidateId: `low-${i}` })
      const higher =
        scoreCandidate(meal('b', { topIngredients: [{ name: 'rice' }] }), SLOT_FIT_WEIGHTS, {
          pantryIngredientNames: PANTRY,
        }) + scoreJitter({ ...seed, candidateId: `high-${i}` })

      expect(higher).toBeGreaterThan(lower)
    }
  })

  it('spreads values across the range rather than clustering', () => {
    const values = Array.from({ length: 200 }, (_, i) =>
      scoreJitter({ ...seed, candidateId: `meal-${i}` }),
    )
    const lowHalf = values.filter((v) => v < SCORE_JITTER_RANGE / 2).length

    expect(lowHalf).toBeGreaterThan(60)
    expect(lowHalf).toBeLessThan(140)
  })
})

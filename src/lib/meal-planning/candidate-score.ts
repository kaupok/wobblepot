import type { ProteinType } from '@/generated/prisma/enums'

/**
 * Candidate ranking for the two meal-swap surfaces.
 *
 * `/entries/[entryId]/suggestions` and `/entries/[entryId]/regenerate` both rank a
 * household-scoped candidate pool with an additive score. They used to carry a private
 * `scoreCandidate()` each, with different weights for the same signal and no record of
 * whether that was deliberate (HON-706). Both now score through this module, and the
 * difference lives in a named profile instead of in two drifting copies.
 */

/**
 * Weight of every signal the score considers, in points.
 *
 * A weight of `0` means the signal is not part of that profile — written out rather than
 * made optional, so the asymmetry between the profiles is visible in both of them.
 */
export interface CandidateScoreWeights {
  /** Household marked the meal a favourite — an explicit, deliberate preference. */
  isFavorite: number
  /** Meal was created or imported by the household rather than seeded. */
  isCustom: number
  /** Meal is flagged kid-friendly. */
  kidFriendly: number
  /** Added once per candidate ingredient the household already has in the pantry. */
  pantryMatchPerIngredient: number
  /** Candidate shares the primary protein type of the meal being replaced. */
  sameProteinType: number
  /** Candidate's prep time is within {@link SIMILAR_PREP_TIME_MINUTES} of the current meal's. */
  similarPrepTime: number
}

/** Prep times within this many minutes of each other count as similar. */
export const SIMILAR_PREP_TIME_MINUTES = 15

/**
 * Slot fit — used by `/suggestions`, which fills an **empty** slot.
 *
 * The question is "what belongs in this slot", so only household-preference signals apply.
 * Favourite is weighted a full point above the similarity profile's, and kid-friendly double
 * it: with no meal to be similar to, preference is the whole signal, and spreading the weights
 * further apart is what keeps a pool of otherwise-identical candidates from collapsing into
 * one big tie.
 *
 * `sameProteinType` and `similarPrepTime` are 0 because there is no reference meal — and the
 * slot's required protein type, where it has one, is already applied upstream as a candidate
 * filter, so scoring it again here would weight it twice.
 */
export const SLOT_FIT_WEIGHTS: CandidateScoreWeights = {
  isFavorite: 3,
  isCustom: 2,
  kidFriendly: 1,
  pantryMatchPerIngredient: 0.5,
  sameProteinType: 0,
  similarPrepTime: 0,
}

/**
 * Similarity — used by `/regenerate`, which **replaces** a meal already in the slot.
 *
 * The question is "what is like the meal already here", so resemblance to the current meal
 * outranks household preference: `sameProteinType` takes the top weight that slot fit gives
 * to `isFavorite`, and every preference signal is deliberately one band lower than its
 * slot-fit counterpart (favourite 2 vs 3, custom 1 vs 2, kid-friendly 0.5 vs 1). A swap that
 * returned the household's favourites regardless of what it is replacing would not be a swap.
 *
 * Pantry matching is the one signal weighted identically in both profiles: "you already have
 * the ingredients" means the same thing whichever question is being asked.
 */
export const SIMILARITY_WEIGHTS: CandidateScoreWeights = {
  isFavorite: 2,
  isCustom: 1,
  kidFriendly: 0.5,
  pantryMatchPerIngredient: 0.5,
  sameProteinType: 3,
  similarPrepTime: 2,
}

export interface ScorableCandidate {
  kidFriendly: boolean
  primaryProteinType: ProteinType
  topIngredients: { name: string }[]
  isFavorite: boolean
  isCustom: boolean
}

export interface CandidateScoreContext {
  /** Candidate's own prep time, when known. Only read by the similarity profile. */
  timeMinutes?: number | null
  /** Primary protein type of the meal being replaced, if there is one. */
  currentProteinType?: ProteinType | null
  /** Prep time of the meal being replaced, if there is one. */
  currentTimeMinutes?: number | null
  /** Pantry ingredient names for the household, lowercased exactly as `getCandidates` emits them. */
  pantryIngredientNames?: Set<string>
}

/**
 * Score a candidate under one of the weight profiles. Higher is better.
 *
 * Pure and jitter-free: the tie-break offset is {@link scoreJitter}, applied by the caller,
 * so a test can pin an exact ranking.
 */
export function scoreCandidate(
  candidate: ScorableCandidate,
  weights: CandidateScoreWeights,
  context: CandidateScoreContext = {},
): number {
  const { timeMinutes, currentProteinType, currentTimeMinutes, pantryIngredientNames } = context
  let score = 0

  if (currentProteinType && candidate.primaryProteinType === currentProteinType) {
    score += weights.sameProteinType
  }

  if (currentTimeMinutes && timeMinutes) {
    const timeDiff = Math.abs(timeMinutes - currentTimeMinutes)
    if (timeDiff <= SIMILAR_PREP_TIME_MINUTES) {
      score += weights.similarPrepTime
    }
  }

  if (candidate.isFavorite) score += weights.isFavorite
  if (candidate.isCustom) score += weights.isCustom
  if (candidate.kidFriendly) score += weights.kidFriendly

  if (pantryIngredientNames && pantryIngredientNames.size > 0) {
    const matchCount = candidate.topIngredients.filter((i) =>
      pantryIngredientNames.has(i.name),
    ).length
    score += matchCount * weights.pantryMatchPerIngredient
  }

  return score
}

/**
 * Width of the tie-break offset, in points.
 *
 * Deliberately below the smallest weight (0.5) so jitter only reorders candidates that are
 * already tied — it can never lift a candidate past one that scored a signal it did not.
 */
export const SCORE_JITTER_RANGE = 0.5

export interface ScoreJitterSeed {
  /** The plan entry being filled or swapped. */
  entryId: string
  /** `YYYY-MM-DD` for the entry's date — rotates the ordering day to day. */
  dateString: string
  /** The candidate being scored. Without it every candidate would get the same offset. */
  candidateId: string
}

/** FNV-1a: a stable 32-bit hash of the seed string. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Deterministic tie-break offset in `[0, SCORE_JITTER_RANGE)`.
 *
 * The integer weights produce many exact ties, so without an offset a household would see the
 * candidate pool's own ordering every time. `Math.random()` gave that variety but made the
 * ranking impossible to assert on, which is why the weights had no regression coverage at all
 * (HON-706). Seeding on entry + date + candidate keeps the variety *between* entries and across
 * days while making any single ranking reproducible.
 *
 * Note the consequence: re-opening the swap modal for the same entry on the same day now returns
 * the same three meals. That is the intended trade — the pool itself changes as the household
 * plans, favourites, and stocks its pantry.
 */
export function scoreJitter({ entryId, dateString, candidateId }: ScoreJitterSeed): number {
  // mulberry32, seeded by the hash — one step is enough for a well-distributed value.
  let state = hashSeed(`${entryId}:${dateString}:${candidateId}`)
  state = (state + 0x6d2b79f5) | 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  const unit = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return unit * SCORE_JITTER_RANGE
}

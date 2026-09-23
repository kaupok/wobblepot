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
  /**
   * Points per net household rating (thumbs-up count minus thumbs-down count across the
   * household's plan entries for the meal), before clamping to the two caps below.
   */
  ratingPerNetVote: number
  /** Most a net-positive rating can add. */
  ratingUpCap: number
  /** Most a net-negative rating can subtract, as a positive number. */
  ratingDownCap: number
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
 * `sameProteinType` and `similarPrepTime` are 0 because an empty slot holds no meal to resemble.
 * Where the slot does require a protein type, that constraint is already applied upstream as a
 * candidate filter, so every candidate would score it identically — which is equally why the
 * similarity profile's +3 is a no-op on a required-protein slot rather than a thumb on the scale.
 */
export const SLOT_FIT_WEIGHTS: CandidateScoreWeights = {
  isFavorite: 3,
  isCustom: 2,
  kidFriendly: 1,
  pantryMatchPerIngredient: 0.5,
  sameProteinType: 0,
  similarPrepTime: 0,
  ratingPerNetVote: 1,
  ratingUpCap: 1,
  ratingDownCap: 2,
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
  ratingPerNetVote: 0.5,
  ratingUpCap: 0.5,
  ratingDownCap: 1,
}

/*
 * The rating term (HON-340) — the same shape in both profiles, one band apart like every other
 * preference signal: a vote is worth the profile's `kidFriendly` weight, the lift is capped at
 * `kidFriendly` and the drop at `isCustom`.
 *
 * Why it sits below `isFavorite`, in both directions: favouriting is a deliberate statement
 * about a meal, a thumb is a reaction to one night's cooking. Neither cap reaches the
 * favourite weight, so no amount of rating can outrank a favourite that is otherwise equal,
 * or erase one — a favourite the household keeps rating down stays above an unrated,
 * unfavourited meal.
 *
 * Why it is asymmetric: one net thumbs-up already takes the whole lift, while the drop keeps
 * deepening through a second net thumbs-down to twice the lift. A meal rejected twice is
 * stronger evidence than a meal enjoyed once, and a swap surface that keeps offering what the
 * household turned down is the failure this term exists to fix.
 *
 * Why it is not smaller: the smallest non-zero value it can take (the similarity profile's
 * 0.5) equals SCORE_JITTER_RANGE, and every value is a multiple of 0.5 like every other weight.
 * The jitter is drawn from the half-open `[0, SCORE_JITTER_RANGE)`, so a rating that fired
 * always beats one that did not — `candidate-score.test.ts` asserts both bounds.
 */

export interface ScorableCandidate {
  kidFriendly: boolean
  primaryProteinType: ProteinType
  topIngredients: { name: string }[]
  isFavorite: boolean
  isCustom: boolean
  /**
   * The household's thumbs-up count minus thumbs-down count for this meal, across its own plan
   * entries only. Absent or 0 when the household has never rated it.
   */
  netRating?: number
}

export interface CandidateScoreContext {
  /**
   * Candidate's own prep time, when known. Read under both profiles — slot fit contributes
   * nothing from it only because its `similarPrepTime` weight is 0.
   */
  timeMinutes?: number | null
  /** Primary protein type of the meal being replaced, if there is one. */
  currentProteinType?: ProteinType | null
  /** Prep time of the meal being replaced, if there is one. */
  currentTimeMinutes?: number | null
  /**
   * Pantry ingredient names for the household, as raw `Ingredient.name` values — the exact
   * strings `getPantryIngredientNames()` returns, matched against the equally raw names on
   * `candidate.topIngredients`. Neither side is normalised; case-folding one and not the other
   * would silently zero the pantry signal.
   */
  pantryIngredientNames?: Set<string>
}

/**
 * Score a candidate under one of the weight profiles. Higher is better.
 *
 * Pure and jitter-free: the tie-break offset is {@link randomScoreJitter}, applied by the
 * caller, so a test can pin an exact ranking.
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

  score += ratingTerm(candidate.netRating, weights)

  return score
}

/** Contribution of a net household rating under a profile — see the rating-term comment above. */
export function ratingTerm(netRating: number | undefined, weights: CandidateScoreWeights): number {
  if (!netRating) return 0
  const raw = netRating * weights.ratingPerNetVote
  return Math.min(weights.ratingUpCap, Math.max(-weights.ratingDownCap, raw))
}

/** Which way a household's ratings moved a candidate, or `undefined` when they did not. */
export type RatingSignal = 'liked' | 'disliked'

/**
 * The swap card's reason for a candidate: set exactly when {@link ratingTerm} is non-zero, so
 * the household sees its feedback whenever — and only when — that feedback moved the ranking.
 */
export function ratingSignal(netRating: number | undefined): RatingSignal | undefined {
  if (!netRating) return undefined
  return netRating > 0 ? 'liked' : 'disliked'
}

/**
 * Width of the tie-break offset, in points.
 *
 * Set to the smallest weight in either profile (`pantryMatchPerIngredient`, 0.5) — and no
 * larger, which is what keeps the jitter to reordering candidates that are already tied. The
 * draw is half-open, `[0, SCORE_JITTER_RANGE)`, so a jittered score is strictly under the next
 * signal up and can never lift a candidate past one that scored a signal it did not. Raising
 * this constant above 0.5 breaks that, and `candidate-score.test.ts` asserts the bound.
 *
 * The argument rests on every weight above being a multiple of 0.5, so a real score gap is
 * either 0 or at least 0.5. Introduce a finer weight — 0.25, say — and this constant has to
 * come down with it, or the jitter starts outranking a signal that genuinely fired.
 */
export const SCORE_JITTER_RANGE = 0.5

export interface ScoreJitterSeed {
  /** The plan entry being filled or swapped. */
  entryId: string
  /**
   * `YYYY-MM-DD` of the day the ranking is being computed **for** — pass today's date,
   * not the entry's. An entry's own date is written once at create and never updated, so
   * seeding on it would be a pure function of `entryId` and add no entropy at all.
   */
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
 * Deterministic tie-break offset in `[0, SCORE_JITTER_RANGE)` — the reproducible counterpart
 * of {@link randomScoreJitter}, for tests that want to pin a ranking without stubbing a draw.
 *
 * Not what the routes ship. HON-706 made this the production jitter, which froze a slot's
 * top 3 for the whole server day; for a household with no favourites, custom meals or pantry
 * every candidate scores 0 or `kidFriendly`, so that top 3 was decided entirely by this offset
 * and reopening the modal could never show anything else. HON-709 moved production to a
 * per-request draw and kept this as the stand-in a test can substitute for it.
 *
 * Seeded on entry + date + candidate: the same seed always yields the same offset, and changing
 * any one part changes it.
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

/** A tie-break offset source. Both {@link scoreJitter} and {@link randomScoreJitter} fit it. */
export type ScoreJitterFn = (seed: ScoreJitterSeed) => number

/**
 * Per-request tie-break offset in `[0, SCORE_JITTER_RANGE)` — what both routes add to every score.
 *
 * The integer weights produce many exact ties, so without an offset a household would see the
 * candidate pool's own ordering every time. A fresh draw on each request is what lets a
 * household reopen the modal for the same slot and see a different top 3 — the only variety a
 * brand-new household gets, since it has no favourites, custom meals or pantry to separate its
 * candidates (HON-709).
 *
 * It ignores `seed`. The routes pass one anyway so that this is the single substitution point:
 * a test replaces it with a stub (`vi.mock`) for an exact ranking, or with {@link scoreJitter}
 * for a reproducible one, without the route changing. `Math.random()` lives here and not at the
 * call site, so `scoreCandidate()` stays pure and the routes never draw randomness themselves.
 */
export const randomScoreJitter: ScoreJitterFn = () => Math.random() * SCORE_JITTER_RANGE

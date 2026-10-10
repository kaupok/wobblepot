import { PORTION_BY_TYPE, sumPortions } from '@/lib/meal-planning/servings'

/**
 * The public sample meal plans at `/meal-plans/<slug>` (HON-1085): six
 * hand-picked weeks of library dinners, each scaled for a stated household.
 * Content, not generation: the page loads these meals by name and never calls
 * the AI or reads a household.
 *
 * Each name must match exactly one global meal in the seed data
 * (`baseMeals` in `prisma/seed.ts` plus `newMeals` in
 * `prisma/seed-expansion.ts`). `sample-weeks.test.ts` checks that, and each
 * week's rule (kid-friendly, time, vegetarian), so a seed rename fails the
 * test rather than the page. English names: the pages are English-only, as
 * the first market is (HON-1073).
 */
export interface SampleWeek {
  /** The URL segment, and the key under `meta.mealPlans` and `mealPlans.pages`. */
  slug: string
  /** Who the quantities are for. Each adult and child counts as `PORTION_BY_TYPE`. */
  household: { adults: number; children: number }
  /**
   * The waitlist source the call to action carries (`/request-invite?ref=`,
   * HON-1089). Must match `WAITLIST_REF_PATTERN` in `src/lib/waitlist.ts`.
   */
  ref: string
  /** Set on a week with no meat, fish or shellfish; adds `suitableForDiet` to its recipes. */
  diet?: 'vegetarian'
  /** Seven English library meal names, Monday to Sunday. */
  meals: readonly [string, string, string, string, string, string, string]
}

/** The sitemap's `lastModified` for the pages. Bump it when a week's meals change. */
export const SAMPLE_WEEKS_LAST_UPDATED = '2026-10-10'

export const SAMPLE_WEEKS = [
  {
    slug: 'family-of-four',
    household: { adults: 2, children: 2 },
    ref: 'mp-family-of-four',
    meals: [
      'Spaghetti Bolognese',
      'Chicken Fajitas',
      'Baked Salmon with Asparagus',
      'Pork Chops with Apple',
      'Margherita Pizza',
      "Shepherd's Pie",
      'Lemon Herb Roast Chicken',
    ],
  },
  {
    slug: 'two-adults-and-a-toddler',
    household: { adults: 2, children: 1 },
    ref: 'mp-two-adults-and-a-toddler',
    meals: [
      'Turkey Meatballs',
      'Fish Fingers with Mash',
      'Mac and Cheese',
      'Cottage Pie',
      'Chicken Pasta',
      'Red Lentil Dal',
      'Pork Fillet with Vegetables',
    ],
  },
  {
    slug: 'one-adult-two-kids',
    household: { adults: 1, children: 2 },
    ref: 'mp-one-adult-two-kids',
    meals: [
      'Beef Tacos',
      'Honey Garlic Salmon',
      'Chicken Quesadillas',
      'Egg Fried Rice',
      'Sausage Pasta',
      'Turkey Burgers',
      'Pinto Bean Burrito Bowl',
    ],
  },
  {
    slug: 'thirty-minute-dinners',
    household: { adults: 2, children: 2 },
    ref: 'mp-thirty-minute-dinners',
    meals: [
      'Chicken Stir-Fry',
      'Lemon Butter Cod',
      'Beef Burrito Bowl',
      'Black Bean Tacos',
      'Spinach Artichoke Pasta',
      'Pork Schnitzel',
      'Honey Lemon Chicken',
    ],
  },
  {
    slug: 'vegetarian-week',
    household: { adults: 2, children: 2 },
    ref: 'mp-vegetarian-week',
    diet: 'vegetarian',
    meals: [
      'Vegetable Lasagne',
      'Chickpea Tikka Masala',
      'Mushroom Stroganoff',
      'Spinach Frittata',
      'Baked Feta Pasta',
      'Three Bean Chilli',
      'Stuffed Peppers',
    ],
  },
  {
    slug: 'kid-friendly-week',
    household: { adults: 2, children: 2 },
    ref: 'mp-kid-friendly-week',
    meals: [
      'Chicken Katsu Curry',
      'Fish Tacos',
      'Meatball Subs',
      'Vegetable Fried Rice',
      'Honey Garlic Pork',
      'Classic Lasagne',
      'Chicken Pot Pie',
    ],
  },
] as const satisfies readonly SampleWeek[]

export type SampleWeekSlug = (typeof SAMPLE_WEEKS)[number]['slug']

/** The week at `slug`, or undefined for any other segment. */
export function findSampleWeek(slug: string): SampleWeek | undefined {
  return SAMPLE_WEEKS.find((week) => week.slug === slug)
}

/**
 * How many servings the week is cooked for: the household's portions summed
 * the way a real household's are (`sumPortions`), with the portion sizes the
 * household form starts a member at. Two adults and two children cook for 3.
 */
export function sampleWeekServings(week: Pick<SampleWeek, 'household'>): number {
  const { adults, children } = week.household
  return sumPortions([
    ...Array.from({ length: adults }, () => ({
      preferences: { portionMultiplier: PORTION_BY_TYPE.adult },
    })),
    ...Array.from({ length: children }, () => ({
      preferences: { portionMultiplier: PORTION_BY_TYPE.child },
    })),
  ])
}

/** The page's path, for the sitemap, the canonical URL and links. */
export function sampleWeekPath(slug: string): string {
  return `/meal-plans/${slug}`
}

'use client'

import type { ComponentType, ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Toggle } from '@/components/ui/toggle'
import { Body, Heading } from '@/components/ui/typography'
import { MemberRow } from '@/components/household/MemberRow'
import { IngredientList } from '@/components/meal-plan/IngredientList'
import { KidFriendlyBadge } from '@/components/meal-plan/KidFriendlyBadge'
import {
  MealImageCard,
  mealHueStyle,
  mealImageTitleWidth,
} from '@/components/meal-plan/MealImageCard'
import { MealTypeBadge } from '@/components/meal-plan/MealTypeBadge'
import { MyRecipeIcon } from '@/components/meal-plan/MyRecipeIcon'
import {
  PreparationSteps,
  type CookQuestionControls,
} from '@/components/meal-plan/PreparationSteps'
import { ServingControl } from '@/components/meal-plan/ServingControl'
import type { MealComponent, PantryIngredient } from '@/components/meal-plan/types'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { formatWeight } from '@/lib/i18n/format-shopping-quantity'
import { sumPortions } from '@/lib/meal-planning/servings'
import type { Locale } from '@/lib/i18n/locales'
import { cn } from '@/lib/utils'
import type { Member, MemberPreferences } from '@/types/member'
import type { Allergen } from '@/generated/prisma/enums'

/**
 * The pantry, portions and cook vignettes show the showcase dinner
 * (`LandingShowcase`), so the section tells one story from the pantry to the
 * stove. The pantry and cook vignettes sit on its tint, the hue `extractHue`
 * returns for its committed illustration.
 */
const SALMON_HUE = 88

/**
 * The imagine vignette shows a different meal, the library's Acai Bowl
 * (`prisma/seed-expansion.ts`), as the dish Imagine a meal produced from the
 * household's description, so the rows alternate tints from `md`: yellow,
 * pink, neutral, yellow (HON-1042). Its illustration is a copy of the meal's
 * generated image and its hue is what `extractHue` returns for that file, as
 * for `LandingShowcase`; the name and description are in the catalog.
 */
const ACAI_BOWL = {
  imageUrl: '/landing/acai-bowl.jpg',
  imageHue: 32,
  mealType: 'breakfast',
} as const

/**
 * A typical household: two adults at a regular portion and a toddler at half
 * of one, so the meal serves 1 + 1 + 0.5 = 2.5, not 3. The app sums the
 * portions the same way (`sumPortions`), so the salmon reads the same here, in
 * the pantry vignette and in the real cook view: per serving × the portions'
 * sum (HON-1040). The catalog names the toddler with her age, since nothing
 * else in the row says she is one. Her 0.5× is not a preset (Small is 0.75×),
 * so her row reads "Custom".
 */
const MEMBERS = [
  { key: 'adult1', portionMultiplier: 1 },
  { key: 'adult2', portionMultiplier: 1 },
  { key: 'toddler', portionMultiplier: 0.5 },
] as const

const SERVINGS = sumPortions(
  MEMBERS.map(({ portionMultiplier }) => ({ preferences: { portionMultiplier } })),
)

/** Grams of salmon per serving; the cook view shows it × `SERVINGS`. */
const SALMON_GRAMS_PER_SERVING = 120

// Quantities per serving, in grams (millilitres for the oil) or (the lemon) pieces.
const INGREDIENTS = [
  {
    key: 'salmon',
    category: 'protein',
    unit: 'g',
    quantityPerServing: SALMON_GRAMS_PER_SERVING,
    inPantry: true,
  },
  { key: 'asparagus', category: 'vegetable', unit: 'g', quantityPerServing: 100, inPantry: true },
  // A liquid: the cook view shows it in ml (HON-1054).
  {
    key: 'oliveOil',
    category: 'fat',
    unit: 'g',
    measuredByVolume: true,
    quantityPerServing: 10,
    inPantry: true,
  },
  // 0.4 × 2.5 servings is one whole lemon.
  { key: 'lemon', category: 'fruit', unit: 'piece', quantityPerServing: 0.4, inPantry: false },
] as const

const POINTS = ['pantry', 'imagine', 'kids', 'cook'] as const
type Point = (typeof POINTS)[number]

const VIGNETTES: Record<Point, ComponentType> = {
  pantry: PantryVignette,
  imagine: ImagineVignette,
  kids: PortionsVignette,
  cook: CookVignette,
}

// A slight tilt on each vignette, in a different direction and amount, so the
// column reads as things laid on a table rather than a grid. Whole degrees
// only, which the rotate scale has.
const TILTS: Record<Point, string> = {
  pantry: 'rotate-1',
  imagine: '-rotate-2',
  kids: 'rotate-2',
  cook: '-rotate-1',
}

// The vignettes are pictures of the app, not controls: `inert` takes their
// checkboxes, field and buttons out of the tab order and the pointer's reach.
const noop = () => {}

/**
 * "Made for family kitchens" on the signed-out home page (HON-1038): the
 * heading, then one row per point, each with a vignette
 * built from the app's own components in a fixed state, so the page proves
 * each claim with the product rather than a picture of it (docs/DESIGN.md →
 * Reject list). Nothing fetches and nothing saves.
 *
 * From `md` each row is two columns and the vignette swaps sides on every
 * other row; below `md` a row is the text, then its vignette. The DOM order is
 * always text first, so a screen reader reads the claim before its caption.
 */
export function LandingFeatures() {
  const t = useTranslations('landing.why')

  return (
    <section aria-labelledby="landing-why" className="flex flex-col gap-12 md:gap-16">
      {/* A statement, not a section label: the hero's size, centred. */}
      <div className="mx-auto max-w-3xl text-center text-balance">
        <Heading variant="h1" as="h2" face="brand" id="landing-why">
          {t('title')}
        </Heading>
      </div>
      {/* WebKit drops list semantics from a `list-style: none` list, so the
          role restores them, as on "How it works". */}
      <ul role="list" className="flex list-none flex-col gap-16 md:gap-24">
        {POINTS.map((point, index) => {
          return (
            <li key={point} className="grid items-center gap-6 md:grid-cols-2 md:gap-16">
              <div className="flex flex-col gap-3 text-balance">
                {/* Two steps above the Section headings this file draws in the
                    vignettes, so the claim leads and the vignette reads as its
                    proof. `IngredientList` keeps its own heading. The title is
                    the page's voice, so it takes the display face; the vignette
                    is the product, so it keeps Geist. */}
                <Heading variant="h3" face="brand">
                  {t(`${point}.title`)}
                </Heading>
                <Body tone="muted">{t(`${point}.body`)}</Body>
              </div>
              <LandingVignette point={point} className={cn(index % 2 === 1 && 'md:order-first')} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export type LandingPoint = Point

/**
 * One point's vignette, tilted, with its caption for screen readers.
 * Exported so another landing layout can place the same vignettes its own way.
 */
export function LandingVignette({ point, className }: { point: Point; className?: string }) {
  const t = useTranslations('landing.why')
  // The portions caption names the salmon the vignette shows.
  const salmon = useScaledSalmon()
  const Vignette = VIGNETTES[point]

  return (
    <figure data-testid={`landing-vignette-${point}`} className={cn('min-w-0', className)}>
      <div inert className={TILTS[point]}>
        <Vignette />
      </div>
      {/* Outside the inert part, which assistive tech skips. */}
      <figcaption className="sr-only">
        {t(`${point}.vignette.caption`, { quantity: salmon })}
      </figcaption>
    </figure>
  )
}

/**
 * Step 1's allergens: three of the household page's chips, nuts and peanuts
 * ticked. Not the salmon's fish, so the step does not contradict the dinner
 * the rest of the page shows.
 */
const HOUSEHOLD_ALLERGENS: ReadonlyArray<{ value: Allergen; pressed: boolean }> = [
  { value: 'dairy', pressed: false },
  { value: 'nuts', pressed: true },
  { value: 'peanuts', pressed: true },
]

/**
 * Who is at the table, as the household page shows it: the member rows, then
 * the allergens to avoid as its chips. No card of its own: the caller's
 * picture panel is its surface. Not inert itself; the caller puts it inside an
 * `inert` picture.
 */
export function HouseholdVignette() {
  const tSettings = useTranslations('household.settings')

  return (
    <div className="flex flex-col gap-4">
      <MemberRows />
      <div className="flex flex-col gap-2">
        <Label>{tSettings('allergensLabel')}</Label>
        <div className="flex flex-wrap gap-2">
          {HOUSEHOLD_ALLERGENS.map(({ value, pressed }) => (
            <AllergenChip key={value} value={value} pressed={pressed} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** The household page's member rows for `MEMBERS`, read-only. */
function MemberRows() {
  const t = useTranslations('landing.why.kids.vignette')
  return (
    <ul className="flex flex-col divide-y">
      {MEMBERS.map(({ key, portionMultiplier }) => (
        <MemberRow
          key={key}
          member={member(key, t(key), portionMultiplier)}
          canEdit={false}
          canRemove={false}
          canInvite={false}
          onEdit={noop}
          onRemove={noop}
          onRemoveFocus={noop}
          onInvite={noop}
          onInviteUpdated={noop}
        />
      ))}
    </ul>
  )
}

/** One allergen chip as `AllergenPicker` draws it, fixed on or off. */
function AllergenChip({ value, pressed }: { value: Allergen; pressed: boolean }) {
  const label = useEnumLabel('Allergen', value)
  return (
    <Toggle variant="outline" tone="primary" size="chip" indicator pressed={pressed}>
      {label}
    </Toggle>
  )
}

/**
 * A card on a meal's tint, as the cook view's panel is, or with no `hue` on
 * the app's neutral card, as the household page's member rows are.
 */
function VignetteSurface({ hue, children }: { hue?: number; children: ReactNode }) {
  return (
    <Card
      size="sm"
      data-meal-surface={hue === undefined ? undefined : ''}
      // eslint-disable-next-line shadcn/no-inline-styles -- --meal-hue is the one per-meal value (docs/DESIGN.md → Imagery); every colour is derived from it by [data-meal-surface] in globals.css.
      style={hue === undefined ? undefined : mealHueStyle(hue)}
    >
      <CardContent className="py-4">{children}</CardContent>
    </Card>
  )
}

function useIngredients(): MealComponent[] {
  const t = useTranslations('landing.why.pantry.vignette')
  return INGREDIENTS.map((item) => ({
    ingredientId: item.key,
    quantityPerServing: item.quantityPerServing,
    ingredient: {
      id: item.key,
      name: t(item.key),
      category: item.category,
      defaultUnit: item.unit,
      measuredByVolume: 'measuredByVolume' in item && item.measuredByVolume,
    },
  }))
}

/** The cook view's ingredients: three ticked as in the pantry, the lemon to buy. */
function PantryVignette() {
  const components = useIngredients()
  const pantryIngredients: PantryIngredient[] = INGREDIENTS.filter((i) => i.inPantry).map((i) => ({
    ingredientId: i.key,
    isStaple: false,
  }))
  const missing = components.filter(
    (c) => !pantryIngredients.some((p) => p.ingredientId === c.ingredientId),
  )

  return (
    <VignetteSurface hue={SALMON_HUE}>
      <IngredientList
        components={components}
        servings={SERVINGS}
        pantryIngredients={pantryIngredients}
        onToggleAvailability={noop}
        availability={{
          isReady: missing.length === 0,
          missingCount: missing.length,
          missingIngredients: missing.map((c) => c.ingredient.name),
        }}
      />
    </VignetteSurface>
  )
}

/**
 * The imagine page's prompt field with the household's description and its
 * Imagine button, then the dish it produced on the planner, marked as the
 * household's own. No photo control: at this size it is a second control that
 * says nothing.
 */
function ImagineVignette() {
  const t = useTranslations('landing.why.imagine.vignette')
  const tImagine = useTranslations('recipes.imagine')
  const name = t('name')

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        readOnly
        value={t('prompt')}
        aria-label={tImagine('promptAria')}
        rows={2}
        className="resize-none"
      />
      {/* The page's button as it draws it from `md`. */}
      <Button className="self-start">
        <Sparkles className="mr-2 h-4 w-4" />
        {tImagine('generate')}
      </Button>
      <MealImageCard
        meal={{
          name,
          imageUrl: ACAI_BOWL.imageUrl,
          imageStatus: 'ready',
          imageHue: ACAI_BOWL.imageHue,
        }}
        size="sm"
        // The planner card's head, as `LandingShowcase` draws it, with the
        // own-recipe mark after the name (`MealCard`). No protein badge: the
        // meal's protein is `none`, for which `ProteinBadge` draws nothing.
        head={
          <CardHeader className="px-4 pt-1 pb-1">
            <div className="flex min-h-8 items-center">
              <div className="flex flex-wrap items-center gap-1.5">
                <MealTypeBadge mealType={ACAI_BOWL.mealType} />
                <KidFriendlyBadge compact />
              </div>
            </div>
            <div className={cn('flex min-w-0 flex-col', mealImageTitleWidth())}>
              <div className="flex min-h-8 items-center">
                <Heading variant="section" as="p">
                  {name}
                  {'\u00a0'}
                  <MyRecipeIcon />
                </Heading>
              </div>
              <div className="hidden md:line-clamp-2">
                <Body variant="muted">{t('description')}</Body>
              </div>
            </div>
          </CardHeader>
        }
      />
    </div>
  )
}

/**
 * A member with an account and no admin role, so `MemberRow` draws no
 * "Owner" or "No account" badge: household admin is not what the vignette
 * shows.
 */
function member(key: string, name: string, portionMultiplier: number): Member {
  const preferences: MemberPreferences = {
    displayName: name,
    portionMultiplier,
    targetCalories: null,
    targetProtein: null,
    targetCarbs: null,
    targetFat: null,
    dietaryType: null,
    allergens: [],
    restrictions: [],
    excludedIngredients: [],
    excludedIngredientIds: [],
  }
  return {
    id: key,
    userId: key,
    name,
    role: 'member',
    joinedAt: '2026-01-01T00:00:00.000Z',
    user: { id: key, name, email: `${key}@example.com`, image: null },
    preferences,
    invite: null,
  }
}

/**
 * The household page's member rows, then the meal's Serves and its salmon, on
 * the neutral card the member rows sit on in the app.
 */
function PortionsVignette() {
  const [salmon] = useIngredients()

  return (
    <VignetteSurface>
      <div className="flex flex-col gap-4">
        <MemberRows />
        <div className="flex">
          <ServingControl
            servings={SERVINGS}
            householdServings={SERVINGS}
            onServingsChange={async () => false}
            disabled
          />
        </div>
        {salmon && <IngredientList components={[salmon]} servings={SERVINGS} />}
      </div>
    </VignetteSurface>
  )
}

/** The salmon for the meal's servings, as the cook view formats it. */
function useScaledSalmon(): string {
  const locale = useLocale() as Locale
  return formatWeight(SALMON_GRAMS_PER_SERVING * SERVINGS, locale)
}

const COOK_QUESTION: CookQuestionControls = {
  openSubject: null,
  onOpenSubject: noop,
  onClose: noop,
  ask: noop,
  active: null,
  previous: null,
  isPending: false,
  isStreaming: false,
  error: null,
  onRetry: noop,
}

/**
 * One step at the cook view's size with its Ask button, and an answer under
 * it. `CookQuestionPanel` is not used for the answer: it has no read-only
 * state (it always shows its chips, field, Send and Close) and scrolls itself
 * into view as it mounts, which would move the landing page on load. The
 * question and the answer take the panel's own type and indent instead.
 */
function CookVignette() {
  const t = useTranslations('landing.why.cook.vignette')
  const tSteps = useTranslations('meal-plan.steps')
  const tAsk = useTranslations('meal-plan.cookQuestion')

  return (
    <VignetteSurface hue={SALMON_HUE}>
      <div className="flex flex-col gap-3">
        {/* Section, not the cook view's Title: the point title beside the
            vignette leads. */}
        <Heading variant="section" as="p">
          {tSteps('steps')}
        </Heading>
        <PreparationSteps
          steps={{ steps: [t('step')], pitfalls: [] }}
          isLoading={false}
          error={null}
          onRetry={noop}
          onToggleStep={noop}
          cookQuestion={COOK_QUESTION}
        />
        {/* The panel's indent inside the toggle list's `-ml-3`, so the
            answer starts where the step text does. */}
        <div className="-ml-3">
          <div className="flex flex-col gap-3 pl-15 lg:pl-16">
            <Body variant="step-small" tone="muted">
              {tAsk('youAsked', { question: t('question') })}
            </Body>
            <Body variant="step">{t('answer')}</Body>
          </div>
        </div>
      </div>
    </VignetteSurface>
  )
}

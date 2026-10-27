import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import {
  createMeal,
  lemonGarlicChickenPantry,
  lemonGarlicChickenPantryItems,
} from '@/stories/fixtures'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { MealCard } from './MealCard'

/**
 * The planner card with the worst data a household can produce (`/break-ui`).
 * `MealCard.stories.tsx` holds the demo data and is at its file-size cap, so
 * the worst case lives here. Each card carries different failures, as a real
 * day column does. Each story asserts what the first `/break-ui` run broke:
 * a note slip stays inside its card, and so does the ⋯ menu, also at 200% text.
 */

/** Card widths: a 320px phone and a 390px phone less the page's `px-4`, and the desktop planner column. */
const CARD_WIDTH = {
  narrow: 'w-[288px]',
  phone: 'w-[358px]',
  desktop: 'w-[776px]',
} as const

const meta = {
  title: 'Meal plan/MealCard/Worst case',
  component: MealCard,
  parameters: { layout: 'padded' },
  globals: { locale: 'et' },
  args: {
    entryId: 'entry-1',
    planId: 'plan-1',
    date: '2026-10-10',
    mealType: MealType.dinner,
    householdServings: 4,
    status: 'planned',
    meal: createMeal(),
    pantryIngredients: lemonGarlicChickenPantry,
    pantryItems: lemonGarlicChickenPantryItems,
  },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelectorAll('[data-slot="card"]')).toHaveLength(5),
    )
    await assertInsideCards(canvasElement, '[data-slot="sticky-note"]')
    await assertBadgesOnTint(canvasElement)
    await assertInsideCards(canvasElement, '[data-slot="dropdown-menu-trigger"]')
    // Text grows and the card does not: a badge wider than the card once
    // pushed the menu off it.
    const root = document.documentElement
    root.style.fontSize = '200%'
    try {
      await assertInsideCards(canvasElement, '[data-slot="dropdown-menu-trigger"]')
    } finally {
      root.style.fontSize = ''
    }
  },
} satisfies Meta<typeof MealCard>

export default meta
type Story = StoryObj<typeof meta>

/** 143 characters, under the 200 of `mealFieldsSchema`: a pasted blog title. */
const LONG_NAME =
  'Vanaema aeglaselt hautatud veiselihapada seente, juurviljade, värske tüümiani ja punase veini kastmega (sobib sügavkülma, jagub kaheks lõunaks)'

const LONG_DESCRIPTION =
  'Pehme veiseliha, mis haudub ahjus kolm tundi koos šampinjonide, porgandi, pastinaagi ja pärlsibulaga. Kaste pakseneb punase veini ja tomatipastaga. Serveeri kartulipüree või rukkileivaga. Kahekordne kogus mahub suurde malmpotti ja külmub hästi kuni kolm kuud.'

/** One word with no break point, wider than the title column on a phone. */
const COMPOUND_NAME = 'Kanafileepastavormiroog'

/** 200 characters, the note's limit. */
const LONG_NOTE =
  'Kasuta suurt potti ja hoia enne kurnamist tass keeduvett kastme jaoks. Mari-Liis ei söö sibulat, nii et tõsta tema portsjon enne sibula lisamist kõrvale. Ülejäägid lähevad karpi homseks lõunaks! Aitäh'

/** A pasted link: 119 characters with no space. */
const URL_NOTE =
  'https://example.com/retseptid/2024/11/kanafileepastavormiroog-juustu-ja-spinatiga?utm_source=uudiskiri&utm_medium=email'

/** Every `selector` match lies inside its card's left and right edges. */
async function assertInsideCards(canvasElement: HTMLElement, selector: string) {
  for (const card of canvasElement.querySelectorAll<HTMLElement>('[data-slot="card"]')) {
    const edges = card.getBoundingClientRect()
    for (const element of card.querySelectorAll<HTMLElement>(selector)) {
      const box = element.getBoundingClientRect()
      await expect(box.left).toBeGreaterThanOrEqual(edges.left - 1)
      await expect(box.right).toBeLessThanOrEqual(edges.right + 1)
    }
  }
}

/**
 * On a card with an image, every badge ends inside the image's short left fade
 * (its first 10%), so none sits on the opaque plate (HON-1358). A single badge
 * wider than its capped row overflows it (`MEAL_IMAGE_BADGE_ROW_WIDTH`), so
 * the check skips it.
 */
async function assertBadgesOnTint(canvasElement: HTMLElement) {
  for (const card of canvasElement.querySelectorAll<HTMLElement>('[data-slot="card"]')) {
    const image = card.querySelector<HTMLElement>('[data-testid="meal-card-image"]')
    if (!image) continue
    const box = image.getBoundingClientRect()
    for (const badge of card.querySelectorAll<HTMLElement>('[data-slot="badge"]')) {
      const edges = badge.getBoundingClientRect()
      if (edges.width > badge.parentElement!.getBoundingClientRect().width) continue
      await expect(edges.right).toBeLessThanOrEqual(box.left + box.width * 0.1)
    }
  }
}

const image = { imageStatus: 'ready' as const, imageUrl: mealIllustration.src, imageHue: 52 }

function WorstCaseColumn({ width }: { width: keyof typeof CARD_WIDTH }) {
  return (
    <div className={`flex flex-col gap-4 ${CARD_WIDTH[width]}`}>
      {/* The longest name and description, every first-row badge at once, a
          large serving override and a full note. */}
      <MealCard
        {...meta.args}
        entryId="entry-long"
        meal={createMeal({
          id: 'meal-long',
          name: LONG_NAME,
          description: LONG_DESCRIPTION,
          isCustom: true,
          primaryProteinType: 'beef',
          ...image,
        })}
        conflicts={[
          { kind: 'allergen', constraint: 'nuts' },
          { kind: 'diet', constraint: 'pescatarian' },
          { kind: 'excluded', constraint: 'onion' },
        ]}
        changes={[
          {
            id: 'change-1',
            original: { id: 'onion', name: 'onion' },
            replacement: null,
            quantityPerServing: null,
            stale: false,
          },
        ]}
        servingOverride={12}
        note={LONG_NOTE}
      />
      {/* Every first-row badge on a tinted card with no note, so nothing
          but the image box caps the badge rows. */}
      <MealCard
        {...meta.args}
        entryId="entry-badges"
        meal={createMeal({
          id: 'meal-badges',
          name: 'Kanapada',
          description: null,
          isCustom: true,
          primaryProteinType: 'poultry',
          ...image,
        })}
        conflicts={[
          { kind: 'allergen', constraint: 'nuts' },
          { kind: 'excluded', constraint: 'onion' },
        ]}
        changes={[
          {
            id: 'change-2',
            original: { id: 'onion', name: 'onion' },
            replacement: null,
            quantityPerServing: null,
            stale: false,
          },
        ]}
        servingOverride={6}
      />
      {/* An unbreakable compound name on the neutral card, the longest slot
          and protein labels, and a pasted link as the note. */}
      <MealCard
        {...meta.args}
        entryId="entry-compound"
        mealType={MealType.breakfast}
        meal={createMeal({
          id: 'meal-compound',
          name: COMPOUND_NAME,
          description: null,
          primaryProteinType: 'none',
        })}
        note={URL_NOTE}
      />
      {/* A three-letter name, skipped, for one serving. */}
      <MealCard
        {...meta.args}
        entryId="entry-short"
        mealType={MealType.lunch}
        meal={createMeal({ id: 'meal-short', name: 'Pho', description: null, ...image })}
        status="skipped"
        servingOverride={1}
      />
      {/* Emoji first, characters that need escaping, an image that 404s, and
          a cooked meal with a rating. */}
      <MealCard
        {...meta.args}
        entryId="entry-escape"
        meal={createMeal({
          id: 'meal-escape',
          name: '🍝 Mac & cheese <laste lemmik>',
          description: 'Juust & piim, **ilma** sibulata.',
          ...image,
          imageUrl: '/missing-meal-image.png',
        })}
        status="completed"
        rating="up"
      />
    </div>
  )
}

/** The 320px phone: every overflow at once. */
export const Narrow: Story = {
  render: () => <WorstCaseColumn width="narrow" />,
}

/** The 390px phone, the default story viewport. */
export const Phone: Story = {
  render: () => <WorstCaseColumn width="phone" />,
}

export const Desktop: Story = {
  render: () => <WorstCaseColumn width="desktop" />,
  globals: { viewport: { value: 'desktop', isRotated: false } },
}

/** The same column in English, whose labels are shorter but whose name lengths are the same. */
export const PhoneEnglish: Story = {
  ...Phone,
  globals: { locale: 'en' },
}

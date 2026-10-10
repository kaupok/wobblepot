import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import MealPlanPage, { generateMetadata } from './page'
import { loadSampleWeek } from '@/lib/meal-plans/load-sample-week'
import type { SampleMealInput } from '@/lib/meal-plans/build-sample-week'

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl')
  const catalog = (locale: string) => (locale === 'et' ? etMessages : enMessages)
  return {
    // The page passes its locale explicitly. A call without one would read
    // the request's locale, simulated here as Estonian, so a forgotten
    // `locale` shows up as Estonian text in the assertions below.
    getTranslations: vi.fn(async ({ locale, namespace }: { locale?: string; namespace: string }) =>
      createTranslator({
        locale: locale ?? 'et',
        messages: catalog(locale ?? 'et') as never,
        namespace: namespace as never,
      }),
    ),
    getMessages: vi.fn(async ({ locale }: { locale?: string } = {}) => catalog(locale ?? 'et')),
  }
})

vi.mock('@/lib/meal-plans/load-sample-week', () => ({
  loadSampleWeek: vi.fn(),
}))

vi.mock('@/lib/env', () => ({
  getServerBaseURL: () => 'https://wobblepot.com',
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

function meal(name: string, overrides: Partial<SampleMealInput> = {}): SampleMealInput {
  return {
    id: `meal-${name}`,
    name,
    description: `${name}, the description`,
    kidFriendly: true,
    timeMinutes: 25,
    primaryProteinType: 'fish',
    imageUrl: null,
    imageStatus: 'none',
    imageHue: null,
    steps: null,
    components: [
      {
        ingredientId: `ing-${name}`,
        quantityPerServing: 100,
        isVague: false,
        originalPhrase: null,
        ingredient: {
          id: `ing-${name}`,
          name: `${name.toLowerCase()} base`,
          category: 'carb',
          defaultUnit: 'g',
          gramsPerPiece: null,
          measuredByVolume: false,
        },
      },
    ],
    ...overrides,
  }
}

const SEVEN = ['Fish Pie', 'Dal', 'Tacos', 'Risotto', 'Pizza', 'Stew', 'Roast'].map((name) =>
  meal(name),
)

function props(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

describe('/meal-plans/[slug]', () => {
  beforeEach(() => {
    vi.mocked(loadSampleWeek).mockResolvedValue(SEVEN)
  })

  describe('generateMetadata', () => {
    it('titles, describes and canonicalises the page from the catalog', async () => {
      const metadata = await generateMetadata(props('vegetarian-week'))
      expect(metadata).toEqual({
        title: 'A week of vegetarian family dinners',
        description: enMessages.meta.mealPlans['vegetarian-week'].description,
        alternates: { canonical: '/meal-plans/vegetarian-week' },
      })
    })

    it('sets no openGraph, so the root image stays', async () => {
      const metadata = await generateMetadata(props('family-of-four'))
      expect(metadata).not.toHaveProperty('openGraph')
    })

    it('is not found for an unknown slug', async () => {
      await expect(generateMetadata(props('nut-free-week'))).rejects.toThrow('NEXT_NOT_FOUND')
    })
  })

  it('is not found for an unknown slug', async () => {
    await expect(MealPlanPage(props('nut-free-week'))).rejects.toThrow('NEXT_NOT_FOUND')
    expect(loadSampleWeek).not.toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'nut-free-week' }),
    )
  })

  describe('a known slug', () => {
    async function renderPage(slug = 'two-adults-and-a-toddler') {
      return render(await MealPlanPage(props(slug)))
    }

    it('heads the page with its title and the household the quantities are for', async () => {
      await renderPage()
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: 'A week of dinners for two adults and a toddler',
        }),
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          'The quantities below are for two adults and a toddler: 2.5 servings at each dinner.',
        ),
      ).toBeInTheDocument()
    })

    it('shows the seven dinners, Monday to Sunday, in English', async () => {
      await renderPage()
      const dinners = screen.getByRole('region', { name: "The week's dinners" })
      const names = within(dinners)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent)
      expect(names).toEqual(SEVEN.map((m) => m.name))
      expect(screen.getByText('Monday')).toBeInTheDocument()
      expect(screen.getByText('Sunday')).toBeInTheDocument()
      // Badges read the nested English provider, not the request's locale.
      expect(screen.getAllByText('Fish').length).toBe(7)
    })

    it('scales each dinner’s ingredients to the household', async () => {
      await renderPage()
      const list = screen.getByRole('list', { name: 'Ingredients: Fish Pie' })
      // 100g a serving × 2.5 servings.
      expect(within(list).getByText('250g')).toBeInTheDocument()
      expect(within(list).getByText('fish pie base')).toBeInTheDocument()
    })

    it('shows one shopping list for the week, grouped by category', async () => {
      await renderPage()
      expect(
        screen.getByRole('heading', { level: 2, name: 'Shopping list for the week' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 3, name: /Carbs 7/ })).toBeInTheDocument()
    })

    it('says the week is an example and links the call to action to the waitlist with its ref', async () => {
      await renderPage()
      expect(screen.getByText(enMessages.mealPlans.disclaimer)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: enMessages.landing.cta })).toHaveAttribute(
        'href',
        '/request-invite?ref=mp-two-adults-and-a-toddler',
      )
    })

    it('embeds the week as an ItemList of Recipe', async () => {
      const { container } = await renderPage()
      const script = container.querySelector('script[type="application/ld+json"]')
      const data = JSON.parse(script!.textContent!)
      expect(data['@type']).toBe('ItemList')
      expect(data.itemListElement).toHaveLength(7)
      expect(data.itemListElement[0].item).toMatchObject({
        '@type': 'Recipe',
        name: 'Fish Pie',
        recipeYield: '2.5 servings',
        totalTime: 'PT25M',
        recipeIngredient: ['250g fish pie base'],
      })
      expect(data.itemListElement[0].url).toBe(
        'https://wobblepot.com/meal-plans/two-adults-and-a-toddler#monday',
      )
    })

    it('marks the page English for every visitor', async () => {
      const { container } = await renderPage()
      expect(container.querySelector('[lang="en"]')).not.toBeNull()
    })
  })
})

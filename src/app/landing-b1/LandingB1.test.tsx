import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { createMeal } from '@/stories/fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'
import type { DemoDay } from '@/lib/landing/load-demo-day'
import { LandingB1 } from './LandingB1'

// `getTranslations` through the real translator, as in `src/app/page.test.tsx`,
// so the server half renders from the catalogs. `translationLocale` switches
// them; the client components read the English mock in `vitest.setup.ts`.
let translationLocale: 'en' | 'et' = 'en'
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl')
  return {
    getTranslations: vi.fn(async (namespace: string) =>
      createTranslator({
        locale: translationLocale,
        messages: (translationLocale === 'et' ? etMessages : enMessages) as never,
        namespace: namespace as never,
      }),
    ),
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/hooks/use-wake-lock', () => ({ useWakeLock: () => {} }))
vi.mock('@/components/meal-plan/MealImage', () => ({ MealImage: () => null }))

/** A Monday, so tonight is the strip's first day and nothing is cooked yet. */
const demo: DemoDay = {
  date: '2026-10-05',
  meals: [
    {
      mealType: 'breakfast',
      servings: 2.5,
      steps: { steps: ['Toast the bread'], pitfalls: [] },
      meal: createMeal({ id: 'd-1', name: 'Porridge with berries', timeMinutes: 10 }),
    },
    {
      mealType: 'lunch',
      servings: 2.5,
      steps: { steps: ['Cook the noodles'], pitfalls: [] },
      meal: createMeal({ id: 'd-2', name: 'Noodle soup', timeMinutes: 20 }),
    },
    {
      mealType: 'dinner',
      servings: 2.5,
      steps: { steps: ['Brown the mince', 'Simmer the sauce'], pitfalls: [] },
      meal: createMeal({ id: 'd-3', name: 'Chilli con carne', timeMinutes: 45 }),
    },
  ],
}

async function renderB1(day: DemoDay | null = null) {
  const { wrapper } = createQueryWrapper()
  return render(await LandingB1({ inviteRequired: false, locale: translationLocale, demo: day }), {
    wrapper,
  })
}

const week = () => screen.getByRole('region', { name: 'This week' })

describe('LandingB1', () => {
  beforeEach(() => {
    translationLocale = 'en'
  })

  it('sets the headline at the hero level, broken after the first sentence', async () => {
    await renderB1()
    const headline = screen.getByRole('heading', {
      level: 1,
      name: 'Dinner, decided. For the whole week.',
    })
    expect(headline).toHaveAttribute('data-variant', 'hero')
    expect(within(headline).getByText((_, el) => el?.tagName === 'BR')).toBeInTheDocument()
  })

  it('keeps one line of small print above the deck, and the rest at the end', async () => {
    const { container } = await renderB1()
    const text = container.textContent ?? ''
    const at = (snippet: string) => {
      expect(text).toContain(snippet)
      return text.indexOf(snippet)
    }
    const deck = at("Thursday · Tonight's dinner")
    expect(at("Free while we're in beta · No ads · Your data stays in the EU")).toBeLessThan(deck)
    expect(at('You hear 30 days before')).toBeGreaterThan(deck)
    expect(at('Your data lives in the EU, and there are no ads.')).toBeGreaterThan(deck)
  })

  it('shows the static Thursday when there is no demo day, with nothing to open', async () => {
    await renderB1()
    expect(screen.getByText("Thursday · Tonight's dinner")).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Baked salmon with asparagus' }),
    ).not.toBeInTheDocument()

    const tonight = within(week())
      .getAllByRole('listitem')
      .find((day) => day.getAttribute('aria-current') === 'date')
    expect(tonight).toHaveTextContent('Thu · Tonight')
    expect(tonight).toHaveTextContent('Baked salmon with asparagus')
    // Monday to Wednesday are cooked.
    expect(within(week()).getAllByText('Cooked')).toHaveLength(3)
  })

  it('lets a keyboard scroll the week strip', async () => {
    await renderB1()
    expect(week()).toHaveAttribute('tabindex', '0')
    expect(within(week()).getAllByRole('listitem')).toHaveLength(7)
  })

  it("puts the demo day's dinner in front, on today's weekday, and opens it in the cook view", async () => {
    const user = userEvent.setup()
    await renderB1(demo)

    expect(screen.getByText("Monday · Tonight's dinner")).toBeInTheDocument()
    const tonight = within(week())
      .getAllByRole('listitem')
      .find((day) => day.getAttribute('aria-current') === 'date')
    expect(tonight).toHaveTextContent('Mon · Tonight')
    expect(tonight).toHaveTextContent('Chilli con carne')
    expect(tonight).toHaveTextContent('45 min')
    expect(within(week()).queryByText('Cooked')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Chilli con carne' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Simmer the sauce')).toBeInTheDocument()
  })

  it('swings a side card to the front, then opens it', async () => {
    const user = userEvent.setup()
    await renderB1(demo)

    await user.click(screen.getByRole('button', { name: 'Noodle soup' }))
    expect(screen.getByText("Monday · Today's lunch")).toBeInTheDocument()
    // The week strip keeps tonight's dinner.
    expect(within(week()).getByText('Chilli con carne')).toBeInTheDocument()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Cook the noodles')).toBeInTheDocument()
  })

  it('reads the server-rendered copy from the Estonian catalog', async () => {
    translationLocale = 'et'
    await renderB1()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Õhtusöök otsustatud. Terveks nädalaks.' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: 'Ütle, kes on laua ääres' }),
    ).toBeInTheDocument()
  })
})

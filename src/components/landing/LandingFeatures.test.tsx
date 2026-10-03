// Use the real next-intl in this file: the global mock in vitest.setup.ts
// renders English only and leaves `{multiplier, number}` unformatted, and this
// suite checks the portion labels and the Estonian section.
import { describe, it, expect, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { PropsWithChildren } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { LandingFeatures } from './LandingFeatures'

function renderFeatures(locale: 'en' | 'et' = 'en') {
  const messages = locale === 'et' ? etMessages : enMessages
  // `MemberRow` mounts its remove mutation, so it needs a query client.
  const { wrapper: QueryWrapper } = createQueryWrapper()
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Tallinn">
        <QueryWrapper>{children}</QueryWrapper>
      </NextIntlClientProvider>
    )
  }
  return render(<LandingFeatures />, { wrapper: Wrapper })
}

const POINTS = ['pantry', 'recipes', 'kids', 'cook'] as const

function vignette(point: (typeof POINTS)[number]) {
  return screen.getByTestId(`landing-vignette-${point}`)
}

/** The vignette's drawing, the part `inert` takes out of reach. */
function drawing(point: (typeof POINTS)[number]) {
  const el = vignette(point).querySelector('[inert]')
  if (!(el instanceof HTMLElement)) throw new Error(`no inert drawing in ${point}`)
  return el
}

describe('LandingFeatures', () => {
  it('renders the heading, the trust line and one row per point', () => {
    renderFeatures()
    const section = screen.getByRole('region', { name: 'Made for family kitchens' })
    expect(
      within(section).getByText(
        'Made by a parent, for a family of three. Your data lives in the EU, and there are no ads.',
      ),
    ).toBeInTheDocument()
    for (const title of [
      'It knows your pantry',
      'Your recipes join the plan',
      'Portions follow the people',
      'Cooking help on the counter',
    ]) {
      expect(within(section).getByRole('heading', { level: 3, name: title })).toBeInTheDocument()
    }
    expect(within(section).getAllByRole('figure')).toHaveLength(4)
  })

  it('makes every vignette inert, with a caption outside the inert part', () => {
    renderFeatures()
    for (const point of POINTS) {
      const figure = vignette(point)
      expect(figure.tagName).toBe('FIGURE')
      expect(drawing(point)).toHaveAttribute('inert')
      const caption = figure.querySelector('figcaption')
      expect(caption).toHaveClass('sr-only')
      expect(caption?.closest('[inert]')).toBeNull()
    }
  })

  it('swaps the vignette to the left on rows 2 and 4 from md, and keeps text first in the DOM', () => {
    renderFeatures()
    POINTS.forEach((point, index) => {
      const figure = vignette(point)
      expect(figure.classList.contains('md:order-first')).toBe(index % 2 === 1)
      // Below md the row stacks in DOM order: the text, then the vignette.
      expect(figure.previousElementSibling?.querySelector('h3')).toBeInTheDocument()
    })
  })

  it('shows the pantry: three ingredients ticked, the lemon to buy', () => {
    renderFeatures()
    const pantry = drawing('pantry')
    expect(within(pantry).getByText('1 to buy')).toBeInTheDocument()
    for (const name of ['Salmon fillet', 'Asparagus', 'Olive oil']) {
      expect(within(pantry).getByRole('checkbox', { name: new RegExp(name) })).toBeChecked()
    }
    expect(within(pantry).getByRole('checkbox', { name: /Lemon/ })).not.toBeChecked()
    expect(within(pantry).getByText('360g')).toBeInTheDocument()
  })

  it('shows a pasted link and the planner card marked as an own recipe', () => {
    renderFeatures()
    const recipes = drawing('recipes')
    const input = within(recipes).getByRole('textbox', { name: 'Recipe link' })
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveValue('https://example.com/baked-salmon-with-asparagus')
    expect(within(recipes).getByText('Baked salmon with asparagus')).toBeInTheDocument()
    expect(within(recipes).getByRole('button', { name: 'My recipe' })).toBeInTheDocument()
  })

  it("scales the salmon by the members' portions: 120 g × (1.5 + 1 + 0.5)", () => {
    renderFeatures()
    const portions = drawing('kids')
    expect(within(portions).getByText('Large 1.5×')).toBeInTheDocument()
    expect(within(portions).getByText('Regular 1×')).toBeInTheDocument()
    expect(within(portions).getByText('Custom 0.5×')).toBeInTheDocument()
    expect(within(portions).getByRole('button', { name: /Serves 3/ })).toBeDisabled()
    expect(within(portions).getByText(`${120 * (1.5 + 1 + 0.5)}g`)).toBeInTheDocument()
    expect(within(vignette('kids')).getByText(/calls for 360g of salmon/)).toBeInTheDocument()
  })

  it('shows one step with its Ask button and the answer under it', () => {
    renderFeatures()
    const cook = drawing('cook')
    expect(within(cook).getByText(/Lay the salmon and asparagus on the tray/)).toBeInTheDocument()
    expect(within(cook).getByRole('button', { name: 'Ask about step 1' })).toBeInTheDocument()
    expect(
      within(cook).getByText('You asked: How do I know the salmon is done?'),
    ).toBeInTheDocument()
    expect(within(cook).getByText(/Press the thickest part with a fork/)).toBeInTheDocument()
  })

  it('shows no image other than the committed meal illustration', () => {
    renderFeatures()
    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAttribute('alt', 'Baked salmon with asparagus')
    expect(images[0]?.getAttribute('src')).toContain('baked-salmon-asparagus.jpg')
  })

  it('renders in Estonian', () => {
    renderFeatures('et')
    const section = screen.getByRole('region', { name: 'Tehtud pereköökidele' })
    expect(
      within(section).getByText(
        'Teinud lapsevanem oma kolmeliikmelisele perele. Sinu andmed on Euroopa Liidus ja reklaame ei ole.',
      ),
    ).toBeInTheDocument()
    expect(within(drawing('pantry')).getByText('Lõhefilee')).toBeInTheDocument()
    expect(within(drawing('kids')).getByText('Suur 1,5×')).toBeInTheDocument()
  })
})

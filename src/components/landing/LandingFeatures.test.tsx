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

const POINTS = ['pantry', 'imagine', 'kids', 'cook'] as const

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
  it('renders the heading and one row per point', () => {
    renderFeatures()
    const section = screen.getByRole('region', { name: 'Made for family kitchens' })
    for (const title of [
      'It knows your pantry',
      'Imagine a meal',
      'Portions follow the people',
      'Cooking help on the counter',
    ]) {
      expect(within(section).getByRole('heading', { level: 3, name: title })).toBeInTheDocument()
    }
    expect(within(section).getAllByRole('figure')).toHaveLength(4)
  })

  it('sets each point title above the headings this component draws in its vignettes', () => {
    renderFeatures()
    const section = screen.getByRole('region', { name: 'Made for family kitchens' })
    for (const name of [
      'It knows your pantry',
      'Imagine a meal',
      'Portions follow the people',
      'Cooking help on the counter',
    ]) {
      // `h3` beside the vignette: above Section, and above the Title-level
      // "Ingredients" heading `IngredientList` draws inside two vignettes.
      expect(within(section).getByRole('heading', { level: 3, name })).toHaveClass('text-2xl')
    }
    for (const heading of within(section).getAllByRole('heading', { level: 3 })) {
      expect(heading).not.toHaveClass('text-base')
    }
  })

  it('sets the section heading and point titles in the display face, and nothing in the vignettes', () => {
    renderFeatures()
    const section = screen.getByRole('region', { name: 'Made for family kitchens' })
    expect(within(section).getByRole('heading', { level: 2 })).toHaveClass('font-display')
    for (const name of [
      'It knows your pantry',
      'Imagine a meal',
      'Portions follow the people',
      'Cooking help on the counter',
    ]) {
      expect(within(section).getByRole('heading', { level: 3, name })).toHaveClass('font-display')
    }
    // The vignettes show the product, so they keep the product's face.
    for (const point of POINTS) {
      expect(drawing(point).querySelector('.font-display')).toBeNull()
    }
  })

  it('tints the vignettes yellow, orange, neutral, yellow: the salmon, the butter chicken, none, the salmon', () => {
    renderFeatures()
    const hues = POINTS.map((point) => {
      const surface = drawing(point).querySelector('[data-meal-surface]')
      return surface instanceof HTMLElement ? surface.style.getPropertyValue('--meal-hue') : null
    })
    expect(hues).toEqual(['88', '48', null, '88'])
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

  it('lays the points out as tiles, two columns from md, each clipping its tilted vignette', () => {
    renderFeatures()
    const list = screen
      .getByRole('region', { name: 'Made for family kitchens' })
      .querySelector('ul')
    expect(list).toHaveClass('grid', 'md:grid-cols-2')
    for (const point of POINTS) {
      expect(vignette(point).closest('li')).toHaveClass('bg-muted', 'overflow-hidden')
    }
  })

  it('shows the pantry: three ingredients ticked, the lemon to buy', () => {
    renderFeatures()
    const pantry = drawing('pantry')
    expect(within(pantry).getByText('1 to buy')).toBeInTheDocument()
    for (const name of ['Salmon fillet', 'Asparagus', 'Olive oil']) {
      expect(within(pantry).getByRole('checkbox', { name: new RegExp(name) })).toBeChecked()
    }
    expect(within(pantry).getByRole('checkbox', { name: /Lemon/ })).not.toBeChecked()
    expect(within(pantry).getByText('300g')).toBeInTheDocument()
    // The oil is a liquid, so it reads in ml (HON-1054).
    expect(within(pantry).getByText('25ml')).toBeInTheDocument()
    expect(within(pantry).getByText('1 pc')).toBeInTheDocument()
  })

  it('shows a description in Imagine a meal and the dinner it produced on the planner, marked as an own recipe', () => {
    renderFeatures()
    const imagine = drawing('imagine')
    const prompt = within(imagine).getByRole('textbox', {
      name: "Describe the meal you're in the mood for",
    })
    expect(prompt).toHaveAttribute('readonly')
    expect(prompt).toHaveValue(
      'Like our Friday takeaway butter chicken, but mild enough for the kids and ready in 40 minutes',
    )
    expect(within(imagine).getByRole('button', { name: 'Imagine meals' })).toBeInTheDocument()
    expect(within(imagine).getByText('Mild butter chicken')).toBeInTheDocument()
    expect(within(imagine).getByText('Dinner')).toBeInTheDocument()
    expect(within(imagine).getByRole('button', { name: 'My recipe' })).toBeInTheDocument()
    expect(within(imagine).getByText('Poultry')).toBeInTheDocument()
  })

  it("scales the salmon by the members' portions: 120 g × (1 + 1 + 0.5)", () => {
    renderFeatures()
    const portions = drawing('kids')
    expect(within(portions).getByText('Mia (2)')).toBeInTheDocument()
    // Household admin is not the claim: no role or account badges.
    expect(within(portions).queryByText('Owner')).not.toBeInTheDocument()
    expect(within(portions).queryByText('No account')).not.toBeInTheDocument()
    expect(within(portions).getAllByText('Regular 1×')).toHaveLength(2)
    expect(within(portions).getByText('Custom 0.5×')).toBeInTheDocument()
    // The toddler is half an adult, so the meal serves 2.5, not the 3 members
    // (HON-1040).
    expect(within(portions).getByRole('button', { name: /Serves 2\.5\./ })).toBeDisabled()
    expect(within(portions).getByText(`${120 * (1 + 1 + 0.5)}g`)).toBeInTheDocument()
    expect(
      within(vignette('kids')).getByText(/serves 2\.5, so it calls for 300g of salmon/),
    ).toBeInTheDocument()
  })

  it('shows one step in large type, then a question about it and the answer', () => {
    renderFeatures()
    const cook = drawing('cook')
    expect(within(cook).getByText(/Lay the salmon and asparagus on the tray/)).toHaveClass(
      'text-lg',
    )
    expect(within(cook).getByText('How do I know the salmon is done?')).toBeInTheDocument()
    expect(within(cook).getByText(/Press the thickest part with a fork/)).toBeInTheDocument()
    // A picture, not the cook view: no step toggle and no Ask button.
    expect(within(cook).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows no image other than the committed meal illustration', () => {
    renderFeatures()
    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAttribute('alt', 'Mild butter chicken')
    expect(images[0]?.getAttribute('src')).toContain('butter-chicken.jpg')
  })

  it('renders in Estonian', () => {
    renderFeatures('et')
    screen.getByRole('region', { name: 'Tehtud pereköökidele' })
    expect(within(drawing('pantry')).getByText('Lõhefilee')).toBeInTheDocument()
    expect(within(drawing('imagine')).getByText('Mahe võikana')).toBeInTheDocument()
    expect(
      within(drawing('imagine')).getByRole('button', { name: 'Mõtle toidud välja' }),
    ).toBeInTheDocument()
    expect(within(drawing('kids')).getByText('Mia (2)')).toBeInTheDocument()
    expect(within(drawing('kids')).getAllByText('Tavaline 1×')).toHaveLength(2)
    expect(within(drawing('kids')).getByRole('button', { name: /^2,5 portsjonit/ })).toBeDisabled()
    expect(within(vignette('kids')).getByText(/Toit on 2,5 portsjonile/)).toBeInTheDocument()
  })
})

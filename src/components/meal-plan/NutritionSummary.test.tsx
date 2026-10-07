import { describe, it, expect, vi } from 'vitest'
// Need the real next-intl provider here so we can verify locale-aware
// integer formatting (HON-556) against the actual catalogs.
vi.unmock('next-intl')
import { fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { NutritionSummary } from './NutritionSummary'

const balanced = { calories: 520, protein: 42, carbs: 30, fat: 28 }
const fourDigitNutrition = { calories: 1250, protein: 95, carbs: 130, fat: 48 }

function renderInLocale(node: ReactNode, locale: 'en' | 'et' = 'en') {
  const messages = locale === 'et' ? etMessages : enMessages
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  )
}

const parts = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-macro-part]')].map(
    (part) => part.dataset.macroPart,
  )

// jsdom lays nothing out, so these cover the markup and the text. Where a real
// browser places the legend's labels is measured by the stories' play functions.
describe('NutritionSummary', () => {
  it('reads kcal, per serving, then grams over name for each macro', () => {
    const { container } = renderInLocale(<NutritionSummary nutrition={balanced} />)
    expect(container.textContent).toBe('520 kcalper serving42gProtein30gCarbs28gFat')
    expect(screen.getByText('520 kcal')).toBeInTheDocument()
    expect(screen.getByText('per serving')).toBeInTheDocument()
  })

  it('draws protein, carbs and fat in that order, hidden from assistive tech', () => {
    const { container } = renderInLocale(<NutritionSummary nutrition={balanced} />)
    expect(parts(container)).toEqual(['protein', 'carbs', 'fat'])
    for (const part of container.querySelectorAll('[data-macro-part]')) {
      expect(part).toHaveAttribute('aria-hidden', 'true')
    }
    // 42g / 30g / 28g is 31 / 22 / 47 of the energy (4/4/9 kcal a gram).
    expect(screen.getByTestId('macro-split').style.getPropertyValue('--macro-split')).toBe(
      'minmax(4px, 31fr) minmax(4px, 22fr) minmax(4px, 47fr)',
    )
  })

  it('colours each part from the series tokens only', () => {
    const { container } = renderInLocale(<NutritionSummary nutrition={balanced} />)
    const fills = [...container.querySelectorAll('[data-macro-part]')].map(
      (part) => [...part.classList].filter((name) => name.startsWith('bg-'))[0],
    )
    expect(fills).toEqual(['bg-series-1', 'bg-series-2', 'bg-series-3'])
  })

  it('reads protein, carbs, then fat in the legend', () => {
    const { container } = renderInLocale(<NutritionSummary nutrition={balanced} />)
    const legend = screen.getByTestId('macro-legend')
    expect(
      [...legend.querySelectorAll<HTMLElement>('[data-macro]')].map((l) => l.dataset.macro),
    ).toEqual(['protein', 'carbs', 'fat'])
    expect(legend.textContent).toBe('42gProtein30gCarbs28gFat')
    expect(container.querySelector('[data-mode]')).toBeNull()
  })

  it('puts "per serving" directly after the calories, in regular weight', () => {
    renderInLocale(<NutritionSummary nutrition={balanced} />)
    const kcal = screen.getByText('520 kcal')
    const perServing = screen.getByText('per serving')
    expect(kcal.nextElementSibling).toContainElement(perServing)
    expect(perServing).toHaveClass('text-xs')
    expect(perServing).not.toHaveClass('font-medium')
  })

  it("places Carbs at its part's centre until a browser measures it (server render)", () => {
    renderInLocale(<NutritionSummary nutrition={balanced} />)
    // 31% protein, then half of 22% carbs.
    const legend = screen.getByTestId('macro-legend')
    expect(legend.style.getPropertyValue('--macro-carbs-x')).toBe('42%')
    expect(legend).not.toHaveAttribute('data-fallback')
    expect(legend.querySelector('[data-macro="carbs"]')).toHaveClass('absolute', 'left-macro-carbs')
  })

  it.each(['default', 'lg'] as const)('draws a 6px bar for the %s size', (size) => {
    const { container } = renderInLocale(<NutritionSummary nutrition={balanced} size={size} />)
    for (const part of container.querySelectorAll('[data-macro-part]')) {
      expect(part).toHaveClass('h-1.5')
    }
    expect(container.firstElementChild).toHaveAttribute('data-size', size)
  })

  it.each([
    ['default', 'figure-small'],
    ['lg', 'figure'],
  ] as const)('sets the %s grams semibold and the names in fine print', (size, figure) => {
    renderInLocale(<NutritionSummary nutrition={balanced} size={size} />)
    expect(screen.getByText('42g')).toHaveClass(
      'font-semibold',
      figure === 'figure' ? 'text-sm' : 'text-xs',
    )
    expect(screen.getByText('Protein')).toHaveClass('text-xs', 'text-muted-foreground')
    expect(screen.getByText('Protein')).not.toHaveClass('font-medium')
  })

  it.each([
    ['a balanced meal', balanced],
    ['a macro at 0g', { calories: 300, protein: 25, carbs: 45, fat: 0 }],
    ['carbs at 0g', { calories: 300, protein: 25, carbs: 0, fat: 20 }],
    ['every macro at 0g', { calories: 0, protein: 0, carbs: 0, fat: 0 }],
  ])('renders no swatch in the legend for %s', (_, nutrition) => {
    renderInLocale(<NutritionSummary nutrition={nutrition} />)
    const legend = screen.getByTestId('macro-legend')
    expect(legend.querySelectorAll('[aria-hidden]')).toHaveLength(0)
    expect(legend.querySelectorAll('[class*="bg-series"]')).toHaveLength(0)
  })

  it('draws no part for a macro at 0g and still names it', () => {
    const { container } = renderInLocale(
      <NutritionSummary nutrition={{ calories: 300, protein: 25, carbs: 45, fat: 0 }} />,
    )
    expect(parts(container)).toEqual(['protein', 'carbs'])
    expect(screen.getByText('0g')).toBeInTheDocument()
    expect(screen.getByText('Fat')).toBeInTheDocument()
  })

  it('centres Carbs at 0g on the boundary between the protein and fat parts', () => {
    // 25g / 0g / 20g: 36% protein, 64% fat.
    renderInLocale(
      <NutritionSummary nutrition={{ calories: 280, protein: 25, carbs: 0, fat: 20 }} />,
    )
    expect(screen.getByTestId('macro-legend').style.getPropertyValue('--macro-carbs-x')).toBe('36%')
  })

  it('draws no bar when every macro is 0', () => {
    const { container } = renderInLocale(
      <NutritionSummary nutrition={{ calories: 0, protein: 0, carbs: 0, fat: 0 }} />,
    )
    expect(screen.queryByTestId('macro-split')).not.toBeInTheDocument()
    expect(container.querySelectorAll('[aria-hidden]')).toHaveLength(0)
    expect(screen.getAllByText('0g')).toHaveLength(3)
    expect(screen.getByTestId('macro-legend').style.getPropertyValue('--macro-carbs-x')).toBe('50%')
  })

  it('groups four-digit calories with a comma in en', () => {
    renderInLocale(<NutritionSummary nutrition={fourDigitNutrition} />)
    // Raw interpolation would render "1250" — the comma proves the value
    // goes through formatInteger.
    expect(screen.getByText('1,250 kcal')).toBeInTheDocument()
  })

  it('renders four-digit calories ungrouped in et', () => {
    renderInLocale(<NutritionSummary nutrition={fourDigitNutrition} />, 'et')
    // CLDR Estonian only groups at 5+ digits, so the locale-correct render
    // is "1250" — an en-formatted "1,250" here would mean the locale is
    // not being threaded through.
    expect(screen.getByText('1250 kcal')).toBeInTheDocument()
    expect(screen.queryByText('1,250 kcal')).not.toBeInTheDocument()
  })

  it('names the macros and the basis in Estonian', () => {
    renderInLocale(<NutritionSummary nutrition={fourDigitNutrition} />, 'et')
    expect(screen.getByText('portsjoni kohta')).toBeInTheDocument()
    expect(screen.getByText('Valgud')).toBeInTheDocument()
    expect(screen.getByText('Süsivesikud')).toBeInTheDocument()
    expect(screen.getByText('Rasvad')).toBeInTheDocument()
  })

  it('formats macros through the locale formatter', () => {
    renderInLocale(<NutritionSummary nutrition={fourDigitNutrition} />)
    expect(screen.getByText('95g')).toBeInTheDocument()
    expect(screen.getByText('130g')).toBeInTheDocument()
    expect(screen.getByText('48g')).toBeInTheDocument()
  })

  it('rounds fractional values like Math.round did', () => {
    renderInLocale(
      <NutritionSummary nutrition={{ calories: 520.6, protein: 41.4, carbs: 30.5, fat: 27.5 }} />,
    )
    // Intl halfExpand rounding matches the previous Math.round behavior
    // for positive values.
    expect(screen.getByText('521 kcal')).toBeInTheDocument()
    expect(screen.getByText('41g')).toBeInTheDocument()
    expect(screen.getByText('31g')).toBeInTheDocument()
    expect(screen.getByText('28g')).toBeInTheDocument()
  })

  describe('vague-quantity info (HON-764, HON-930)', () => {
    const nutrition = { calories: 520, protein: 42, carbs: 30, fat: 12 }

    it.each(['default', 'lg'] as const)(
      'renders an (i) button after "per serving" that opens the explanation (%s)',
      async (size) => {
        const { container } = renderInLocale(
          <NutritionSummary nutrition={nutrition} size={size} components={[{ isVague: true }]} />,
        )
        // The asterisk and the caption line are gone. The sentence's only
        // home outside the popover is the button's screen-reader description.
        const sentence = 'Includes estimates for vague quantities like “to taste”.'
        expect(container.textContent).not.toContain('*')
        expect(screen.getByText(sentence)).toHaveClass('sr-only')

        const button = screen.getByRole('button', { name: 'About these numbers' })
        expect(button).toHaveAccessibleDescription(sentence)
        expect(button.previousElementSibling).toHaveTextContent('per serving')
        fireEvent.click(button)
        const popover = await screen.findByRole('dialog', { name: 'About these numbers' })
        expect(within(popover).getByText(sentence)).toBeInTheDocument()
      },
    )

    it('labels the button and explains in Estonian', async () => {
      renderInLocale(
        <NutritionSummary nutrition={nutrition} components={[{ isVague: true }]} />,
        'et',
      )
      const sentence = 'Sisaldab hinnanguid umbmääraste koguste kohta, nagu „maitse järgi”.'
      const button = screen.getByRole('button', { name: 'Nende numbrite kohta' })
      expect(button).toHaveAccessibleDescription(sentence)
      fireEvent.click(button)
      const popover = await screen.findByRole('dialog', { name: 'Nende numbrite kohta' })
      expect(within(popover).getByText(sentence)).toBeInTheDocument()
    })

    it('renders no button without vague quantities', () => {
      const { container } = renderInLocale(
        <NutritionSummary nutrition={nutrition} components={[{ isVague: false }]} />,
      )
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(container.textContent).not.toContain('*')
    })
  })
})

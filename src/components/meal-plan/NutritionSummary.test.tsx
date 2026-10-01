import { describe, it, expect, vi } from 'vitest'
// Need the real next-intl provider here so we can verify locale-aware
// integer formatting (HON-556) against the actual catalogs.
vi.unmock('next-intl')
import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { NutritionSummary } from './NutritionSummary'

const fourDigitNutrition = { calories: 1250, protein: 95, carbs: 130, fat: 48 }

function renderInLocale(node: ReactNode, locale: 'en' | 'et' = 'en') {
  const messages = locale === 'et' ? etMessages : enMessages
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  )
}

describe('NutritionSummary', () => {
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

  it('formats macros through the locale formatter in the grid layout', () => {
    renderInLocale(<NutritionSummary nutrition={fourDigitNutrition} />)
    expect(screen.getByText('95g')).toBeInTheDocument()
    expect(screen.getByText('130g')).toBeInTheDocument()
    expect(screen.getByText('48g')).toBeInTheDocument()
  })

  it('formats the compact line through the locale formatter', () => {
    renderInLocale(<NutritionSummary nutrition={fourDigitNutrition} compact />)
    expect(screen.getByText(/1,250 kcal/)).toBeInTheDocument()
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

    it.each([
      ['compact', true],
      ['full', false],
    ])('renders an (i) button that opens the explanation in %s mode', async (_mode, compact) => {
      const { container } = renderInLocale(
        <NutritionSummary
          nutrition={nutrition}
          compact={compact}
          components={[{ isVague: true }]}
        />,
      )
      // The asterisk and the caption line are gone; the button replaces both.
      expect(container.textContent).not.toContain('*')
      expect(screen.queryByText(/includes estimates/i)).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'About these numbers' }))
      expect(
        await screen.findByText('Includes estimates for vague quantities like “to taste”.'),
      ).toBeInTheDocument()
    })

    it('labels the button and explains in Estonian', async () => {
      renderInLocale(
        <NutritionSummary nutrition={nutrition} compact components={[{ isVague: true }]} />,
        'et',
      )
      fireEvent.click(screen.getByRole('button', { name: 'Nende numbrite kohta' }))
      expect(
        await screen.findByText(
          'Sisaldab hinnanguid umbmääraste koguste kohta, nagu „maitse järgi”.',
        ),
      ).toBeInTheDocument()
    })

    it.each([
      ['compact', true],
      ['full', false],
    ])('renders no button in %s mode without vague quantities', (_mode, compact) => {
      const { container } = renderInLocale(
        <NutritionSummary
          nutrition={nutrition}
          compact={compact}
          components={[{ isVague: false }]}
        />,
      )
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(container.textContent).not.toContain('*')
    })
  })
})

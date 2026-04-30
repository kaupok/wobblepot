import { describe, it, expect, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { LowConfidenceIngredientRow } from './LowConfidenceIngredientRow'
import type { LowConfidenceIngredientData } from './IngredientRow'

function renderInLocale(node: ReactNode, locale: 'en' | 'et') {
  const messages = locale === 'en' ? enMessages : etMessages
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  )
}

const lowConfidence: LowConfidenceIngredientData = {
  type: 'low-confidence',
  extractedName: 'chicken thighs',
  originalText: '600g chicken thighs',
  ingredient: {
    id: 'chicken-thigh',
    name: 'Chicken thigh',
    category: 'protein',
    defaultUnit: 'g',
    gramsPerPiece: null,
  },
  alternatives: [],
  totalQuantity: 600,
  isVague: false,
  originalPhrase: null,
}

describe('LowConfidenceIngredientRow per-serving formatting', () => {
  it('renders period decimal in en for fractional per-serving quantity', () => {
    renderInLocale(
      <LowConfidenceIngredientRow
        data={lowConfidence}
        servings={400}
        disabled={false}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onQuantityChange={vi.fn()}
        onSetQuantity={vi.fn()}
        onMarkAsVague={vi.fn()}
      />,
      'en',
    )
    expect(screen.getByText(/1\.5g per serving/)).toBeInTheDocument()
  })

  it('renders comma decimal in et for fractional per-serving quantity', () => {
    renderInLocale(
      <LowConfidenceIngredientRow
        data={lowConfidence}
        servings={400}
        disabled={false}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onQuantityChange={vi.fn()}
        onSetQuantity={vi.fn()}
        onMarkAsVague={vi.fn()}
      />,
      'et',
    )
    expect(screen.getByText(/1,5g portsjoni kohta/)).toBeInTheDocument()
  })
})

import { describe, it, expect, vi } from 'vitest'
// `useLocale()` requires the real next-intl context; the global mock only
// stubs `useTranslations`.
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { IngredientRow, type MatchedIngredientData } from './IngredientRow'

function renderInLocale(node: ReactNode, locale: 'en' | 'et') {
  const messages = locale === 'en' ? enMessages : etMessages
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  )
}

const matched: MatchedIngredientData = {
  type: 'matched',
  ingredient: {
    id: 'chicken-thigh',
    name: 'Chicken thigh',
    category: 'protein',
    defaultUnit: 'g',
    gramsPerPiece: null,
  },
  totalQuantity: 600,
  isVague: false,
  originalPhrase: null,
}

describe('IngredientRow per-serving formatting', () => {
  it('renders period decimal in en for matched ingredient', () => {
    // 600g / 4 servings = 150g — integer, no decimal.
    renderInLocale(
      <IngredientRow data={matched} servings={4} onUpdate={vi.fn()} onRemove={vi.fn()} />,
      'en',
    )
    expect(screen.getByText(/150g per serving/)).toBeInTheDocument()
  })

  it('renders comma decimal in et for fractional per-serving quantity', () => {
    // 600g / 400 servings = 1.5g per serving — exercises the decimal path.
    renderInLocale(
      <IngredientRow data={matched} servings={400} onUpdate={vi.fn()} onRemove={vi.fn()} />,
      'et',
    )
    expect(screen.getByText(/1,5g per serving/)).toBeInTheDocument()
  })

  it('renders period decimal in en for fractional per-serving quantity', () => {
    renderInLocale(
      <IngredientRow data={matched} servings={400} onUpdate={vi.fn()} onRemove={vi.fn()} />,
      'en',
    )
    expect(screen.getByText(/1\.5g per serving/)).toBeInTheDocument()
  })
})

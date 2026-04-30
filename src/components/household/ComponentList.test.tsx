import { describe, it, expect, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { ComponentList } from './ComponentList'
import type { MealComponent } from './meal-form-types'

function renderInLocale(node: ReactNode, locale: 'en' | 'et') {
  const messages = locale === 'en' ? enMessages : etMessages
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  )
}

const component: MealComponent = {
  ingredientId: 'chicken-thigh',
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

describe('ComponentList per-serving formatting', () => {
  it('renders period decimal in en for fractional per-serving quantity', () => {
    // 600g / 400 servings = 1.5g per serving — exercises the decimal path.
    renderInLocale(
      <ComponentList
        components={[component]}
        servings={400}
        disabled={false}
        duplicateMap={new Map()}
        onRemove={vi.fn()}
        onUpdateQuantity={vi.fn()}
        onSetQuantity={vi.fn()}
        onMarkAsVague={vi.fn()}
      />,
      'en',
    )
    expect(screen.getByText(/1\.5g per serving/)).toBeInTheDocument()
  })

  it('renders comma decimal in et for fractional per-serving quantity', () => {
    renderInLocale(
      <ComponentList
        components={[component]}
        servings={400}
        disabled={false}
        duplicateMap={new Map()}
        onRemove={vi.fn()}
        onUpdateQuantity={vi.fn()}
        onSetQuantity={vi.fn()}
        onMarkAsVague={vi.fn()}
      />,
      'et',
    )
    expect(screen.getByText(/1,5g portsjoni kohta/)).toBeInTheDocument()
  })
})

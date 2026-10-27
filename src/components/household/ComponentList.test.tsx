import { describe, it, expect, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('renders a vague phrase in the household language (HON-917)', () => {
    renderInLocale(
      <ComponentList
        components={[{ ...component, isVague: true, originalPhrase: 'to taste' }]}
        servings={4}
        disabled={false}
        duplicateMap={new Map()}
        onRemove={vi.fn()}
        onUpdateQuantity={vi.fn()}
        onSetQuantity={vi.fn()}
        onMarkAsVague={vi.fn()}
      />,
      'et',
    )
    expect(screen.getByText('maitse järgi')).toBeInTheDocument()
  })
})

// HON-1361
describe('ComponentList row controls', () => {
  const egg: MealComponent = {
    ingredientId: 'egg',
    ingredient: { id: 'egg', name: 'Egg', category: 'protein', defaultUnit: 'piece' },
    totalQuantity: 1,
    isVague: false,
    originalPhrase: null,
  }

  function renderList(locale: 'en' | 'et', onRemove = vi.fn()) {
    return renderInLocale(
      <ComponentList
        components={[component, egg]}
        servings={3}
        disabled={false}
        duplicateMap={new Map()}
        onRemove={onRemove}
        onUpdateQuantity={vi.fn()}
        onSetQuantity={vi.fn()}
        onMarkAsVague={vi.fn()}
      />,
      locale,
    )
  }

  it('names each remove button after its ingredient', async () => {
    const onRemove = vi.fn()
    renderList('en', onRemove)

    expect(screen.queryByRole('button', { name: '×' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Egg' }))
    expect(onRemove).toHaveBeenCalledWith('egg')
  })

  it('names the remove button from the Estonian catalog', () => {
    renderList('et')

    expect(screen.getByRole('button', { name: 'Eemalda „Chicken thigh"' })).toBeInTheDocument()
  })

  it.each([
    ['en', 'pc', '0.3 pc per serving'],
    ['et', 'tk', '0,3 tk portsjoni kohta'],
  ] as const)('labels a piece ingredient in %s', (locale, unit, line) => {
    renderList(locale)

    expect(screen.getByText(unit, { exact: true })).toBeInTheDocument()
    expect(screen.getByText(line)).toBeInTheDocument()
  })
})

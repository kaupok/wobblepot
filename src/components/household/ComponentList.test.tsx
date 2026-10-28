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
        onQuantityEnter={vi.fn()}
        showEmptyQuantityErrors={false}
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
        onQuantityEnter={vi.fn()}
        showEmptyQuantityErrors={false}
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
        onQuantityEnter={vi.fn()}
        showEmptyQuantityErrors={false}
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
        onQuantityEnter={vi.fn()}
        showEmptyQuantityErrors={false}
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

// HON-1362
describe('ComponentList empty quantity', () => {
  const potato: MealComponent = {
    ingredientId: 'potato',
    ingredient: { id: 'potato', name: 'Potato', category: 'vegetable', defaultUnit: 'g' },
    totalQuantity: null,
  }

  function renderEmpty({
    showEmptyQuantityErrors = false,
    onQuantityEnter = vi.fn(),
    onUpdateQuantity = vi.fn(),
    locale = 'en' as 'en' | 'et',
  } = {}) {
    return renderInLocale(
      <form onSubmit={(e) => e.preventDefault()}>
        <ComponentList
          components={[component, potato]}
          servings={4}
          disabled={false}
          duplicateMap={new Map()}
          onRemove={vi.fn()}
          onUpdateQuantity={onUpdateQuantity}
          onSetQuantity={vi.fn()}
          onMarkAsVague={vi.fn()}
          onQuantityEnter={onQuantityEnter}
          showEmptyQuantityErrors={showEmptyQuantityErrors}
        />
      </form>,
      locale,
    )
  }

  it('shows an empty field with the suggested amount as its placeholder', () => {
    renderEmpty()

    const field = screen.getByRole('textbox', { name: 'Total quantity for Potato' })
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder', '100')
    expect(field).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('Quantity must be greater than 0')).not.toBeInTheDocument()
  })

  it('suggests one piece for a piece ingredient, in the household locale', () => {
    renderInLocale(
      <ComponentList
        components={[
          {
            ingredientId: 'egg',
            ingredient: { id: 'egg', name: 'Egg', category: 'protein', defaultUnit: 'piece' },
            totalQuantity: null,
          },
        ]}
        servings={4}
        disabled={false}
        duplicateMap={new Map()}
        onRemove={vi.fn()}
        onUpdateQuantity={vi.fn()}
        onSetQuantity={vi.fn()}
        onMarkAsVague={vi.fn()}
        onQuantityEnter={vi.fn()}
        showEmptyQuantityErrors={false}
      />,
      'et',
    )

    expect(screen.getByRole('textbox', { name: /Egg/ })).toHaveAttribute('placeholder', '1')
  })

  it('reports a cleared field as null, so the form can flag it on save', async () => {
    const onUpdateQuantity = vi.fn()
    renderEmpty({ onUpdateQuantity })

    const chicken = screen.getByRole('textbox', { name: 'Total quantity for Chicken thigh' })
    await userEvent.clear(chicken)
    expect(onUpdateQuantity).toHaveBeenLastCalledWith('chicken-thigh', null)
  })

  it('asks the form to focus the search on Enter, and does not submit', async () => {
    const onQuantityEnter = vi.fn()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    renderInLocale(
      <form onSubmit={onSubmit}>
        <ComponentList
          components={[potato]}
          servings={4}
          disabled={false}
          duplicateMap={new Map()}
          onRemove={vi.fn()}
          onUpdateQuantity={vi.fn()}
          onSetQuantity={vi.fn()}
          onMarkAsVague={vi.fn()}
          onQuantityEnter={onQuantityEnter}
          showEmptyQuantityErrors={false}
        />
        <button type="submit">Save</button>
      </form>,
      'en',
    )

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Total quantity for Potato' }),
      '300{Enter}',
    )
    expect(onQuantityEnter).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('flags the empty row once the form tried to save', () => {
    renderEmpty({ showEmptyQuantityErrors: true })

    expect(screen.getByRole('textbox', { name: 'Total quantity for Potato' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByText('Quantity must be greater than 0')).toBeInTheDocument()
  })
})

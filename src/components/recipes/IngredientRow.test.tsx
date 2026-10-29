import { afterEach, describe, expect, it, vi } from 'vitest'
// `useLocale()` requires the real next-intl context; the global mock only
// stubs `useTranslations`.
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { type ReactNode, useState } from 'react'

import { createQueryWrapper } from '@/test/query-wrapper'

import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { IngredientRow, type IngredientRowData, type MatchedIngredientData } from './IngredientRow'

function renderInLocale(node: ReactNode, locale: 'en' | 'et') {
  const messages = locale === 'en' ? enMessages : etMessages
  // Unmatched rows search the ingredient catalog through `useIngredientSearch`.
  const { wrapper: QueryWrapper } = createQueryWrapper()
  return render(
    <QueryWrapper>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {node}
      </NextIntlClientProvider>
    </QueryWrapper>,
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
    expect(screen.getByText(/1,5g portsjoni kohta/)).toBeInTheDocument()
  })

  it('renders period decimal in en for fractional per-serving quantity', () => {
    renderInLocale(
      <IngredientRow data={matched} servings={400} onUpdate={vi.fn()} onRemove={vi.fn()} />,
      'en',
    )
    expect(screen.getByText(/1\.5g per serving/)).toBeInTheDocument()
  })

  it('renders a vague phrase in the household language (HON-917)', () => {
    renderInLocale(
      <IngredientRow
        data={{ ...matched, isVague: true, originalPhrase: 'a pinch' }}
        servings={4}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
      'et',
    )
    expect(screen.getByText('näputäis')).toBeInTheDocument()
  })
})

// HON-1263: the control that resolved an unmatched row unmounts with it, so the
// matched row that replaces it takes focus on its quantity, not <body>.
// HON-1361: a piece ingredient shows its unit as the cook view does (HON-956).
describe('IngredientRow piece unit', () => {
  const egg: MatchedIngredientData = {
    ...matched,
    ingredient: { id: 'egg', name: 'Egg', category: 'protein', defaultUnit: 'piece' },
    totalQuantity: 1,
  }

  it.each([
    ['en', 'pc', '0.3 pc per serving'],
    ['et', 'tk', '0,3 tk portsjoni kohta'],
  ] as const)('labels the field and the per-serving line in %s', (locale, unit, line) => {
    renderInLocale(
      <IngredientRow data={egg} servings={3} onUpdate={vi.fn()} onRemove={vi.fn()} />,
      locale,
    )
    expect(screen.getByText(unit, { exact: true })).toBeInTheDocument()
    expect(screen.getByText(line)).toBeInTheDocument()
  })
})

describe('IngredientRow focus after resolve', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function ResolvingRow() {
    const [data, setData] = useState<IngredientRowData>({
      type: 'unmatched',
      extractedName: 'lovage',
      originalText: '20 g lovage',
      extractedQuantity: 20,
      extractedUnit: 'g',
    })
    return (
      <IngredientRow
        data={data}
        servings={2}
        onUpdate={setData}
        onRemove={vi.fn()}
        onResolve={(ingredient, totalQuantity) =>
          setData({ type: 'matched', ingredient, totalQuantity })
        }
      />
    )
  }

  it('moves focus to the quantity input of the matched row', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ingredients: [{ id: 'lovage', name: 'lovage', category: 'vegetable', defaultUnit: 'g' }],
        }),
      ),
    )
    const user = userEvent.setup()
    renderInLocale(<ResolvingRow />, 'en')

    await user.type(screen.getByRole('textbox', { name: 'Find a match for lovage' }), 'lov')
    await user.click(await screen.findByRole('button', { name: /^lovage/ }, { timeout: 2000 }))

    expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveFocus()
  })
})

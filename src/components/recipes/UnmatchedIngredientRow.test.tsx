import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { UnmatchedIngredientRow } from './UnmatchedIngredientRow'
import type { UnmatchedIngredientData } from './IngredientRow'
import { imaginedIngredientText } from '@/lib/ai/imagine-request'

function data(extractedName: string): UnmatchedIngredientData {
  return {
    type: 'unmatched',
    extractedName,
    originalText: `200g ${extractedName}`,
    extractedQuantity: 200,
    extractedUnit: 'g',
  }
}

describe('UnmatchedIngredientRow search field name', () => {
  // getByLabelText matches aria-label but not a placeholder (HON-808). Several
  // rows render at once on the import review, so each name carries its
  // ingredient. The global next-intl mock answers from the English catalog.
  it('names each row search after the ingredient it resolves', () => {
    const { wrapper } = createQueryWrapper()
    render(
      <>
        <UnmatchedIngredientRow data={data('gochujang')} disabled={false} onRemove={vi.fn()} />
        <UnmatchedIngredientRow data={data('yuzu kosho')} disabled={false} onRemove={vi.fn()} />
      </>,
      { wrapper },
    )

    expect(screen.getByLabelText('Find a match for gochujang')).toHaveAttribute(
      'placeholder',
      'Search ingredients…',
    )
    expect(screen.getByLabelText('Find a match for yuzu kosho')).toBeInTheDocument()
  })
})

describe('UnmatchedIngredientRow original line', () => {
  // Imagine no longer asks the model for originalText; the route rebuilds it
  // (HON-897), and the row must still show it.
  it('shows the rebuilt text of an unmatched imagined ingredient', () => {
    const { wrapper } = createQueryWrapper()
    const ingredient = { name: 'yuzu kosho', quantity: 2, unit: 'tsp' as const, vaguePhrase: null }
    render(
      <UnmatchedIngredientRow
        data={{
          type: 'unmatched',
          extractedName: ingredient.name,
          originalText: imaginedIngredientText(ingredient, 'en'),
          extractedQuantity: ingredient.quantity,
          extractedUnit: ingredient.unit,
        }}
        disabled={false}
        onRemove={vi.fn()}
      />,
      { wrapper },
    )

    expect(screen.getByText('Original: 2 tsp yuzu kosho')).toBeInTheDocument()
  })
})

describe('UnmatchedIngredientRow vague phrase', () => {
  // The global next-intl mock answers from the English catalog, so a bare
  // "pinch" coming back as "a pinch" proves the row reads the catalog (HON-917).
  it('renders the phrase through the enums.VaguePhrase catalog', () => {
    const { wrapper } = createQueryWrapper()
    render(
      <UnmatchedIngredientRow
        data={{ ...data('saffron'), isVague: true, originalPhrase: 'pinch' }}
        disabled={false}
        onRemove={vi.fn()}
      />,
      { wrapper },
    )

    expect(screen.getByText('a pinch')).toBeInTheDocument()
  })
})

// HON-1100: a row found by another English name shows that name in brackets.
describe('UnmatchedIngredientRow other English name', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the typed name in brackets and resolves to the row without it', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ingredients: [
            {
              id: 'sugar',
              name: 'powdered sugar',
              category: 'carb',
              defaultUnit: 'g',
              matchedAs: 'icing sugar',
            },
          ],
        }),
    })
    const onResolve = vi.fn()
    const user = userEvent.setup()
    const { wrapper } = createQueryWrapper()
    render(
      <UnmatchedIngredientRow
        data={data('icing sugar')}
        disabled={false}
        onRemove={vi.fn()}
        onResolve={onResolve}
      />,
      { wrapper },
    )

    await user.type(screen.getByRole('textbox'), 'icing')
    const option = await screen.findByRole('button', { name: /powdered sugar/ }, { timeout: 2000 })
    expect(option).toHaveTextContent('powdered sugar(icing sugar)')

    await user.click(option)

    expect(onResolve).toHaveBeenCalledWith(
      { id: 'sugar', name: 'powdered sugar', category: 'carb', defaultUnit: 'g' },
      100,
    )
  })
})

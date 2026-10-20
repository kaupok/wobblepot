import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { stubPointerApis } from '@/test/household-settings'
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
              name: 'icing sugar',
              category: 'carb',
              defaultUnit: 'g',
              matchedAs: 'powdered sugar',
            },
          ],
        }),
    })
    const onResolve = vi.fn()
    const user = userEvent.setup()
    const { wrapper } = createQueryWrapper()
    render(
      <UnmatchedIngredientRow
        data={data('powdered sugar')}
        disabled={false}
        onRemove={vi.fn()}
        onResolve={onResolve}
      />,
      { wrapper },
    )

    await user.type(screen.getByRole('textbox'), 'powdered')
    const option = await screen.findByRole('button', { name: /icing sugar/ }, { timeout: 2000 })
    expect(option).toHaveTextContent('icing sugar(powdered sugar)')

    await user.click(option)

    expect(onResolve).toHaveBeenCalledWith(
      { id: 'sugar', name: 'icing sugar', category: 'carb', defaultUnit: 'g' },
      100,
    )
  })
})

// HON-1263: "Add as new ingredient" opens a form in place of the search.
describe('UnmatchedIngredientRow add as new ingredient', () => {
  const lovage = {
    id: 'ing-lovage',
    name: 'lovage',
    category: 'vegetable',
    defaultUnit: 'g',
    gramsPerPiece: null,
    measuredByVolume: false,
    calories: 36,
    protein: 3,
    carbs: 6,
    fat: 1,
  }

  beforeEach(() => {
    stubPointerApis()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderRow(row: UnmatchedIngredientData, onResolve = vi.fn()) {
    const { wrapper } = createQueryWrapper()
    render(
      <UnmatchedIngredientRow
        data={row}
        disabled={false}
        onRemove={vi.fn()}
        onResolve={onResolve}
      />,
      { wrapper },
    )
    return { onResolve }
  }

  async function saveForm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Add as new ingredient: lovage' }))
    await user.click(screen.getByRole('combobox', { name: 'Category' }))
    await user.click(await screen.findByRole('option', { name: 'Vegetables' }))
    for (const [label, value] of [
      ['Calories, kcal', '36'],
      ['Protein, g', '3'],
      ['Carbs, g', '6'],
      ['Fat, g', '1'],
    ]) {
      await user.type(screen.getByLabelText(label!), value!)
    }
    await user.click(screen.getByRole('button', { name: 'Save ingredient' }))
  }

  const respond = (status: number, body: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }))

  it('opens the form in place of the search, and Cancel returns focus to the button', async () => {
    const user = userEvent.setup()
    renderRow(data('lovage'))

    await user.click(screen.getByRole('button', { name: 'Add as new ingredient: lovage' }))

    expect(screen.queryByLabelText('Find a match for lovage')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Add as new ingredient: lovage' })).toHaveFocus()
  })

  it('resolves with the saved ingredient and the parsed spoons in grams', async () => {
    respond(201, { ingredient: lovage })
    const user = userEvent.setup()
    const { onResolve } = renderRow({
      ...data('lovage'),
      extractedQuantity: 2,
      extractedUnit: 'tsp',
    })

    await saveForm(user)

    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(lovage, 10))
  })

  it('resolves a vague row with 100 g', async () => {
    respond(201, { ingredient: lovage })
    const user = userEvent.setup()
    const { onResolve } = renderRow({
      ...data('lovage'),
      extractedQuantity: 0,
      isVague: true,
      originalPhrase: 'a handful',
    })

    await saveForm(user)

    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(lovage, 100))
  })

  it('keeps the parsed quantity when its unit is the new ingredient unit', async () => {
    respond(201, { ingredient: lovage })
    const user = userEvent.setup()
    const { onResolve } = renderRow(data('lovage'))

    await saveForm(user)

    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(lovage, 200))
  })

  it('shows the catalog line on a 429, not the server text', async () => {
    respond(429, { error: 'Rate limit exceeded' })
    const user = userEvent.setup()
    const { onResolve } = renderRow(data('lovage'))

    await saveForm(user)

    expect(await screen.findByText('Too many new ingredients, try again later')).toBeInTheDocument()
    expect(screen.queryByText('Rate limit exceeded')).not.toBeInTheDocument()
    expect(onResolve).not.toHaveBeenCalled()
  })
})

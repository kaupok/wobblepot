import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdjustProposal } from '@/lib/meal-planning/adjust-proposal'

import { AdjustReviewDialog } from './AdjustReviewDialog'
import type { EntryChange } from './types'

// The search's results, so a test can pick one without the ingredient route.
vi.mock('@/hooks/use-ingredient-search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-ingredient-search')>()),
  useIngredientSearch: (query: string) => ({
    data: query
      ? [{ id: 'gochujang', name: 'Gochujang', category: 'condiments', defaultUnit: 'g' }]
      : [],
    isLoading: false,
  }),
}))

const replaceCream: AdjustProposal = {
  op: 'replace',
  original: { id: 'cream', name: 'Cream' },
  originalIngredientId: 'cream',
  replacesChangeId: null,
  replacement: {
    matched: true,
    ingredient: { id: 'yoghurt', name: 'Yoghurt', defaultUnit: 'g', measuredByVolume: false },
    quantityPerServing: 100,
  },
  reason: 'Yoghurt keeps the sauce creamy.',
}

const addPaste: AdjustProposal = {
  op: 'add',
  original: null,
  originalIngredientId: null,
  replacesChangeId: null,
  replacement: { matched: false, name: 'chilli paste', quantity: 5, unit: 'g' },
  reason: 'It adds heat.',
}

const removeMushroom: AdjustProposal = {
  op: 'remove',
  original: { id: 'mushroom', name: 'Mushroom' },
  originalIngredientId: 'mushroom',
  replacesChangeId: null,
  replacement: null,
  reason: 'You asked to leave them out.',
}

const stored: EntryChange[] = [
  {
    id: 'c1',
    original: null,
    replacement: { id: 'basil', name: 'Basil' },
    quantityPerServing: 2,
    stale: false,
  },
]

function renderDialog(proposals: AdjustProposal[], onApply = vi.fn(async () => true)) {
  const onOpenChange = vi.fn()
  render(
    <AdjustReviewDialog
      open
      onOpenChange={onOpenChange}
      instruction="No cream, and spicier"
      proposals={proposals}
      changes={stored}
      existingIngredientIds={['pasta', 'cream', 'mushroom', 'basil']}
      isApplying={false}
      onApply={onApply}
    />,
  )
  return { onApply, onOpenChange }
}

const apply = () => screen.getByRole('button', { name: 'Apply' })

describe('AdjustReviewDialog', () => {
  // jsdom has no scrollIntoView; the ingredient search scrolls its results
  // into view (HON-1378).
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })

  it('shows each change ticked, in catalog copy, with the reason', () => {
    renderDialog([replaceCream, removeMushroom])

    expect(
      screen.getByRole('checkbox', { name: 'Replace: Cream → Yoghurt, 100g per serving' }),
    ).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Leave out: Mushroom' })).toBeChecked()
    expect(screen.getByText('Yoghurt keeps the sauce creamy.')).toBeInTheDocument()
    expect(screen.getByText('You asked: No cream, and spicier')).toBeInTheDocument()
  })

  it('applies the stored changes plus every ticked row, and closes', async () => {
    const { onApply, onOpenChange } = renderDialog([replaceCream, removeMushroom])

    await userEvent.click(apply())

    expect(onApply).toHaveBeenCalledWith([
      { originalIngredientId: null, replacementIngredientId: 'basil', quantityPerServing: 2 },
      {
        originalIngredientId: 'cream',
        replacementIngredientId: 'yoghurt',
        quantityPerServing: 100,
      },
      { originalIngredientId: 'mushroom', replacementIngredientId: null, quantityPerServing: null },
    ])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('leaves an unticked row out of the set', async () => {
    const { onApply } = renderDialog([replaceCream, removeMushroom])

    await userEvent.click(screen.getByRole('checkbox', { name: 'Leave out: Mushroom' }))
    await userEvent.click(apply())

    expect(onApply).toHaveBeenCalledWith([
      { originalIngredientId: null, replacementIngredientId: 'basil', quantityPerServing: 2 },
      {
        originalIngredientId: 'cream',
        replacementIngredientId: 'yoghurt',
        quantityPerServing: 100,
      },
    ])
  })

  it('holds Apply on an unmatched ticked row until it is unticked', async () => {
    renderDialog([replaceCream, addPaste])

    expect(
      screen.getByText(
        '“chilli paste” is not in the ingredient list. Pick an ingredient, or untick this change.',
      ),
    ).toBeInTheDocument()
    expect(apply()).toBeDisabled()

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Add: chilli paste, 5g per serving' }),
    )

    expect(apply()).toBeEnabled()
  })

  it('applies an unmatched row once an ingredient is picked', async () => {
    const { onApply } = renderDialog([addPaste])

    await userEvent.type(screen.getByRole('combobox'), 'goch')
    await userEvent.click(await screen.findByRole('option', { name: /Gochujang/ }))

    expect(screen.getByRole('checkbox', { name: 'Add: Gochujang, 5g per serving' })).toBeChecked()
    await userEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith([
      { originalIngredientId: null, replacementIngredientId: 'basil', quantityPerServing: 2 },
      { originalIngredientId: null, replacementIngredientId: 'gochujang', quantityPerServing: 5 },
    ])
  })

  it('says to tick a change when none is ticked, and holds Apply', async () => {
    renderDialog([removeMushroom])

    await userEvent.click(screen.getByRole('checkbox', { name: 'Leave out: Mushroom' }))

    expect(screen.getByText('Tick at least one change to apply.')).toBeInTheDocument()
    expect(apply()).toBeDisabled()
  })

  it('stays open when the apply is refused', async () => {
    const { onOpenChange } = renderDialog(
      [removeMushroom],
      vi.fn(async () => false),
    )

    await userEvent.click(apply())

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

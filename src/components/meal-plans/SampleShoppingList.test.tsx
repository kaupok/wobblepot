import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SampleShoppingList } from './SampleShoppingList'

const groups = [
  {
    category: 'protein' as const,
    items: [
      { id: 'cod', name: 'cod fillet', quantity: '450g', isVague: false },
      { id: 'egg', name: 'egg', quantity: '6 pc', isVague: false },
    ],
  },
  {
    category: 'spice' as const,
    items: [{ id: 'salt', name: 'salt', quantity: 'some', isVague: true }],
  },
]

describe('SampleShoppingList', () => {
  it('heads each category with its name and count, in the given order', () => {
    render(<SampleShoppingList groups={groups} />)
    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings.map((heading) => heading.textContent)).toEqual(['🥩Protein 2', '🌿Spices 1'])
  })

  it('lists each item with its quantity under its category', () => {
    render(<SampleShoppingList groups={groups} />)
    const protein = screen.getByRole('list', { name: 'Protein 2' })
    expect(
      within(protein)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(['cod fillet450g', 'egg6 pc'])
  })

  it('draws the list on the shopping note sheet', () => {
    const { container } = render(<SampleShoppingList groups={groups} />)
    expect(container.querySelector('[data-surface="note"]')).not.toBeNull()
  })
})

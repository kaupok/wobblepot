import { describe, it, expect } from 'vitest'
import { formatShoppingListForClipboard, type ClipboardSection } from './format-clipboard'

describe('formatShoppingListForClipboard', () => {
  it('returns an empty string when there are no sections', () => {
    expect(formatShoppingListForClipboard('Shopping list · Sep 1 – 7, 2026', [])).toBe('')
  })

  it('returns an empty string when every section is empty', () => {
    const sections: ClipboardSection[] = [
      { heading: '🥩 Protein (0)', lines: [] },
      { heading: '🥬 Vegetables (0)', lines: [] },
    ]

    expect(formatShoppingListForClipboard('Shopping list', sections)).toBe('')
  })

  it('drops empty sections and keeps the order of the survivors', () => {
    const sections: ClipboardSection[] = [
      { heading: '🥩 Protein (1)', lines: ['Chicken breast 600g'] },
      { heading: '🧀 Dairy (0)', lines: [] },
      { heading: '🥬 Vegetables (1)', lines: ['Broccoli 500g'] },
    ]

    expect(formatShoppingListForClipboard('Shopping list', sections)).toBe(
      [
        'Shopping list',
        '',
        '🥩 Protein (1)',
        '- Chicken breast 600g',
        '',
        '🥬 Vegetables (1)',
        '- Broccoli 500g',
      ].join('\n'),
    )
  })

  it('renders a null heading as lines only', () => {
    const sections: ClipboardSection[] = [{ heading: null, lines: ['Broccoli 500g', 'Carrot 4'] }]

    expect(formatShoppingListForClipboard('Shopping list', sections)).toBe(
      'Shopping list\n\n- Broccoli 500g\n- Carrot 4',
    )
  })

  it('separates sections with exactly one blank line and adds no trailing newline', () => {
    const output = formatShoppingListForClipboard('Shopping list', [
      { heading: 'A (1)', lines: ['One'] },
      { heading: 'B (1)', lines: ['Two'] },
    ])

    expect(output).not.toMatch(/\n$/)
    expect(output).not.toContain('\n\n\n')
    expect(output.split('\n\n')).toHaveLength(3)
  })

  it('matches the worked example from HON-370', () => {
    const output = formatShoppingListForClipboard('Shopping list · Sep 1 – 7, 2026', [
      { heading: '🥩 Protein (2)', lines: ['Chicken breast 600g', 'Salmon fillet 400g'] },
      { heading: '🥬 Vegetables (3)', lines: ['Broccoli 500g', 'Carrot 4', 'Onion 300g'] },
      { heading: '📝 Other (1)', lines: ['Baking paper'] },
    ])

    expect(output).toBe(
      `Shopping list · Sep 1 – 7, 2026

🥩 Protein (2)
- Chicken breast 600g
- Salmon fillet 400g

🥬 Vegetables (3)
- Broccoli 500g
- Carrot 4
- Onion 300g

📝 Other (1)
- Baking paper`,
    )
  })
})

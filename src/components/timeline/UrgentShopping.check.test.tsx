import { describe, expect, it, vi } from 'vitest'
// `useLocale()` requires the real next-intl context; the global mock only
// stubs `useTranslations`.
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'

import { pantryCheckRows } from '@/stories/pantry-check-fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import enMessages from '../../../messages/en.json'
import { UrgentShopping } from './UrgentShopping'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('{}', { status: 200 })),
)

const TODAY = '2026-11-01'

// First needed on Wednesday: in the check, past the panel's two days.
const carrot = pantryCheckRows[1]!

const milk = {
  ingredientId: 'milk',
  name: 'Milk',
  displayQuantity: '1 l',
  neededByDate: TODAY,
  neededByRelative: 'Today',
  purchased: false,
  urgency: 'today' as const,
}

const { wrapper: QueryWrapper } = createQueryWrapper()

function panel(props: Partial<Parameters<typeof UrgentShopping>[0]> = {}) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <QueryWrapper>
        <UrgentShopping items={[]} todayDate={TODAY} {...props} />
      </QueryWrapper>
    </NextIntlClientProvider>
  )
}

function renderPanel(props: Partial<Parameters<typeof UrgentShopping>[0]> = {}) {
  return render(panel(props))
}

/** The cards the panel renders, by their title. */
const cardTitles = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-slot="card"]')].map(
    (card) => card.querySelector('[data-slot="card-title"]')?.textContent,
  )

describe('UrgentShopping — the check (HON-1585, HON-1638)', () => {
  it('shows the check as its own plain card above the Shopping list note, with no tabs', () => {
    const { container } = renderPanel({ items: [milk], check: pantryCheckRows })

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(cardTitles(container)).toEqual(['Enough at home?', 'Shopping list'])
    const [checkCard, listCard] = container.querySelectorAll('[data-slot="card"]')
    expect(checkCard).not.toHaveAttribute('data-surface')
    expect(listCard).toHaveAttribute('data-surface', 'note')

    const check = screen.getByRole('list', { name: 'Enough at home?' })
    expect(checkCard).toContainElement(check)
    expect(listCard).toContainElement(screen.getByRole('list', { name: 'Today' }))
    // The whole window's check, Wednesday's included.
    expect(within(check).getByText(/Basil/)).toBeInTheDocument()
  })

  it('names the check by its card title, with no Caption of its own', () => {
    renderPanel({ check: pantryCheckRows })

    expect(screen.getAllByText('Enough at home?')).toHaveLength(1)
    expect(screen.getByText('Enough at home?')).toHaveAttribute('data-slot', 'card-title')
  })

  it('puts the stock control on each check row', () => {
    renderPanel({ check: pantryCheckRows })

    expect(screen.getAllByRole('radiogroup', { name: /^Stock: / })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /Add to list/ })).not.toBeInTheDocument()
  })

  it('shows the check and the empty line when nothing is due today or tomorrow', () => {
    const { container } = renderPanel({ check: pantryCheckRows })

    expect(cardTitles(container)).toEqual(['Enough at home?', 'Shopping list'])
    expect(screen.getByText('Nothing on the list for today or tomorrow')).toBeInTheDocument()
  })

  it('shows only the Shopping list card when the check is empty', () => {
    const { container } = renderPanel({ items: [milk] })

    expect(cardTitles(container)).toEqual(['Shopping list'])
    expect(screen.queryByText('Enough at home?')).not.toBeInTheDocument()
  })

  it('keeps focus on the pressed part when the refresh brings the marked row back', async () => {
    const { rerender } = renderPanel({ check: [carrot] })

    await userEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Stock: Carrot' })).getByRole('radio', {
        name: 'Low',
      }),
    )
    // The refresh: carrot is low now, and stays in the check.
    rerender(panel({ check: [{ ...carrot, stock: 'low' }] }))

    const low = within(screen.getByRole('radiogroup', { name: 'Stock: Carrot' })).getByRole(
      'radio',
      { name: 'Low' },
    )
    expect(low).toHaveFocus()
    expect(low).toHaveAttribute('aria-checked', 'true')
  })

  it('leaves the check out of the phone form', () => {
    const { container } = renderPanel({ check: pantryCheckRows, compact: true })

    expect(container).toBeEmptyDOMElement()
  })
})

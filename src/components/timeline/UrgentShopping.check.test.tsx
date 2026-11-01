import { describe, expect, it, vi } from 'vitest'
// `useLocale()` requires the real next-intl context; the global mock only
// stubs `useTranslations`.
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import { pantryCheckRows } from '@/stories/pantry-check-fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import enMessages from '../../../messages/en.json'
import { UrgentShopping } from './UrgentShopping'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const TODAY = '2026-11-01'

const milk = {
  ingredientId: 'milk',
  name: 'Milk',
  displayQuantity: '1 l',
  neededByDate: TODAY,
  neededByRelative: 'Today',
  purchased: false,
  urgency: 'today' as const,
}

function renderPanel(props: Partial<Parameters<typeof UrgentShopping>[0]> = {}) {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <QueryWrapper>
        <UrgentShopping items={[]} todayDate={TODAY} {...props} />
      </QueryWrapper>
    </NextIntlClientProvider>,
  )
}

describe('UrgentShopping — the check (HON-1585)', () => {
  it('shows the check first, above the day groups, with no tabs', () => {
    renderPanel({ items: [milk], check: pantryCheckRows })

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    const check = screen.getByRole('list', { name: 'Enough at home?' })
    const today = screen.getByRole('list', { name: 'Today' })
    expect(check.compareDocumentPosition(today) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The whole window's check, Wednesday's included.
    expect(within(check).getByText(/Basil/)).toBeInTheDocument()
  })

  it('shows the check and the empty line when nothing is due today or tomorrow', () => {
    renderPanel({ check: pantryCheckRows })

    expect(screen.getByRole('list', { name: 'Enough at home?' })).toBeInTheDocument()
    expect(screen.getByText('Nothing on the list for today or tomorrow')).toBeInTheDocument()
  })

  it('shows only the empty line when the check is empty too', () => {
    renderPanel()

    expect(screen.queryByText('Enough at home?')).not.toBeInTheDocument()
    expect(screen.getByText('Nothing on the list for today or tomorrow')).toBeInTheDocument()
  })

  it('leaves the check out of the phone form', () => {
    const { container } = renderPanel({ check: pantryCheckRows, compact: true })

    expect(container).toBeEmptyDOMElement()
  })
})

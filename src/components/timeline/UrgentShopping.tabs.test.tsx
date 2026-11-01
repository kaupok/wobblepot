import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// `useLocale()` requires the real next-intl context; the global mock only
// stubs `useTranslations`.
vi.unmock('next-intl')
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'

import type { UrgencyBucket } from '@/lib/meal-planning/dates'
import { createQueryWrapper } from '@/test/query-wrapper'

import enMessages from '../../../messages/en.json'
import type { AtHomeItem } from './AtHomeList'
import { UrgentShopping } from './UrgentShopping'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

// The "To buy" and "At home" tabs of the full panel (HON-1578).

const TODAY = '2026-11-01'

function toBuy(name: string, urgency: UrgencyBucket = 'today', ranOut = false) {
  return {
    ranOut,
    ingredientId: `ing-${name}`,
    name,
    displayQuantity: '1 pc',
    neededByDate: TODAY,
    neededByRelative: 'Today',
    purchased: false,
    urgency,
  }
}

function atHome(name: string, urgency: UrgencyBucket = 'today'): AtHomeItem {
  return {
    ingredientId: `ing-${name}`,
    name,
    displayQuantity: '200g',
    neededByDate: TODAY,
    urgency,
    pantryRows: [{ id: `pantry-${name}`, quantity: null }],
    isStaple: false,
  }
}

function renderPanel({
  items = [] as ReturnType<typeof toBuy>[],
  atHomeItems = [] as AtHomeItem[],
  compact = false,
} = {}) {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  const tree = (rows: AtHomeItem[]) => (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <QueryWrapper>
        <UrgentShopping items={items} atHomeItems={rows} todayDate={TODAY} compact={compact} />
      </QueryWrapper>
    </NextIntlClientProvider>
  )
  const view = render(tree(atHomeItems))
  return { ...view, rerenderAtHome: (rows: AtHomeItem[]) => view.rerender(tree(rows)) }
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('UrgentShopping tabs', () => {
  it('shows To buy and At home, with To buy selected and its rows on load', () => {
    renderPanel({ items: [toBuy('Milk')], atHomeItems: [atHome('Rice')] })

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['To buy', 'At home'])
    expect(screen.getByRole('tab', { name: 'To buy' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Milk')
    expect(screen.queryByText('Rice')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('opens At home by keyboard, and shows only its rows', async () => {
    renderPanel({ items: [toBuy('Milk')], atHomeItems: [atHome('Rice')] })

    await userEvent.tab()
    expect(screen.getByRole('tab', { name: 'To buy' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'At home' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Rice')
    expect(screen.queryByText('Milk')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Have it: Rice' })).toBeChecked()
  })

  it('keeps the tabs with nothing to buy, so At home can open', async () => {
    renderPanel({ atHomeItems: [atHome('Rice')] })

    expect(screen.getByRole('tabpanel')).toHaveTextContent(
      'Nothing on the list for today or tomorrow',
    )
    await userEvent.click(screen.getByRole('tab', { name: 'At home' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Rice')
  })

  it('shows a muted line on At home when the pantry covers nothing for the two days', async () => {
    renderPanel({ items: [toBuy('Milk')], atHomeItems: [atHome('Rice', 'later')] })

    await userEvent.click(screen.getByRole('tab', { name: 'At home' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent(
      'Nothing from the pantry for today or tomorrow',
    )
  })

  it('tags a To buy row whose pantry row ran out with "Ran out"', () => {
    renderPanel({ items: [toBuy('Milk'), toBuy('Rice', 'today', true)] })

    expect(screen.getByText('Rice').closest('li')).toHaveTextContent('Ran out')
    expect(screen.getByText('Milk').closest('li')).not.toHaveTextContent('Ran out')
  })

  it('keeps the continuation row on To buy only', async () => {
    renderPanel({ items: [toBuy('Milk'), toBuy('Eggs', 'later')], atHomeItems: [atHome('Rice')] })

    expect(screen.getByRole('link', { name: /Plus 1 more/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'At home' }))
    expect(screen.queryByRole('link', { name: /Plus 1 more/ })).not.toBeInTheDocument()
  })

  it('shows the current empty state, with no tabs, when both lists are empty', () => {
    renderPanel({ atHomeItems: [atHome('Rice', 'later')] })

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByText('Nothing on the list for today or tomorrow')).toBeInTheDocument()
  })

  it('leaves the phone summary as it was: nothing when nothing is to buy', () => {
    const { container } = renderPanel({ atHomeItems: [atHome('Rice')], compact: true })

    expect(container).toBeEmptyDOMElement()
  })

  it('drops a switched-off row on a tab change', async () => {
    const { rerenderAtHome } = renderPanel({
      items: [toBuy('Milk')],
      atHomeItems: [atHome('Rice'), atHome('Salt')],
    })
    await userEvent.click(screen.getByRole('tab', { name: 'At home' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Have it: Rice' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    rerenderAtHome([atHome('Salt')])
    expect(screen.getByRole('switch', { name: 'Have it: Rice' })).not.toBeChecked()

    await userEvent.click(screen.getByRole('tab', { name: 'To buy' }))
    await userEvent.click(screen.getByRole('tab', { name: 'At home' }))

    expect(screen.queryByRole('switch', { name: 'Have it: Rice' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Have it: Salt' })).toBeInTheDocument()
  })
})

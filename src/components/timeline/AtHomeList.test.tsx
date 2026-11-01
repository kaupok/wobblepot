import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// `useLocale()` requires the real next-intl context; the global mock only
// stubs `useTranslations`.
vi.unmock('next-intl')
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { toast } from 'sonner'

import { createQueryWrapper } from '@/test/query-wrapper'

import enMessages from '../../../messages/en.json'
import { type AtHomeItem, AtHomeList } from './AtHomeList'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

function row(name: string, overrides: Partial<AtHomeItem> = {}): AtHomeItem {
  const key = name.toLowerCase().replace(' ', '-')
  return {
    ingredientId: `ing-${key}`,
    name,
    displayQuantity: '200g',
    neededByDate: '2026-11-01',
    urgency: 'today',
    pantryRows: [{ id: `pantry-${key}`, quantity: null }],
    isStaple: false,
    ...overrides,
  }
}

const rice = row('Rice', { pantryRows: [{ id: 'pantry-rice', quantity: 200 }] })
const salt = row('Salt', {
  isStaple: true,
  displayQuantity: '8g',
  pantryRows: [{ id: 'pantry-salt', quantity: 5 }],
})
// Kept at home by its own row and by the fresh basil row (HON-1558).
const basil = row('Basil', {
  urgency: 'tomorrow',
  pantryRows: [
    { id: 'pantry-basil', quantity: 2 },
    { id: 'pantry-fresh-basil', quantity: null },
  ],
})

function renderList(items: AtHomeItem[]) {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  const tree = (rows: AtHomeItem[]) => (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <QueryWrapper>
        <AtHomeList items={rows} />
      </QueryWrapper>
    </NextIntlClientProvider>
  )
  const view = render(tree(items))
  return { ...view, rerenderWith: (rows: AtHomeItem[]) => view.rerender(tree(rows)) }
}

const fetchMock = vi.fn()

/** The PATCH requests sent, as `[url, body]`. */
const patches = () =>
  (fetchMock.mock.calls as [string, RequestInit][]).map(([url, init]) => [
    url,
    JSON.parse(init.body as string),
  ])

beforeEach(() => {
  // A new response per call: a body reads once.
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('AtHomeList', () => {
  it('groups the rows by day, each with its amount and a switch that is on', () => {
    renderList([rice, salt, basil])

    const today = screen.getByRole('list', { name: 'Today' })
    expect(
      within(today)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Rice200gHave it', 'Salt8gHave it'])
    const tomorrow = screen.getByRole('list', { name: 'Tomorrow' })
    expect(within(tomorrow).getByRole('switch', { name: 'Have it: Basil' })).toBeChecked()
  })

  it('marks a staple with the star, and only a staple', () => {
    renderList([rice, salt])

    expect(screen.getAllByRole('img', { name: 'Staple' })).toHaveLength(1)
    const saltRow = screen.getByRole('switch', { name: 'Have it: Salt' }).closest('li')!
    expect(within(saltRow).getByRole('img', { name: 'Staple' })).toBeInTheDocument()
  })

  it('shows a muted line when nothing for today or tomorrow is at home', () => {
    renderList([row('Rice', { urgency: 'later' })])

    expect(screen.getByText('Nothing from the pantry for today or tomorrow')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('sets the pantry row to 0 when the switch goes off, then refreshes', async () => {
    renderList([rice])
    const control = screen.getByRole('switch', { name: 'Have it: Rice' })

    await userEvent.click(control)

    expect(control).not.toBeChecked()
    expect(control).toHaveFocus()
    expect(control.closest('li')).toHaveTextContent('Ran out')
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(patches()).toEqual([['/api/pantry/pantry-rice', { quantity: 0 }]])
  })

  it('switches off every row that keeps a herb at home, and restores each', async () => {
    renderList([basil])
    const control = screen.getByRole('switch', { name: 'Have it: Basil' })

    await userEvent.click(control)
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    await userEvent.click(control)

    await waitFor(() =>
      expect(patches()).toEqual([
        ['/api/pantry/pantry-basil', { quantity: 0 }],
        ['/api/pantry/pantry-fresh-basil', { quantity: 0 }],
        ['/api/pantry/pantry-basil', { quantity: 2 }],
        ['/api/pantry/pantry-fresh-basil', { quantity: null }],
      ]),
    )
  })

  it('keeps a switched-off row after the refresh drops it, and restores its count', async () => {
    const { rerenderWith } = renderList([rice, salt])
    const control = screen.getByRole('switch', { name: 'Have it: Rice' })
    await userEvent.click(control)
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))

    // The refreshed server list has no rice: it is at 0 now.
    rerenderWith([{ ...salt }])

    expect(screen.getByRole('switch', { name: 'Have it: Rice' })).toBe(control)
    expect(control).not.toBeChecked()
    expect(control).toHaveFocus()

    await userEvent.click(control)

    expect(control).toBeChecked()
    await waitFor(() =>
      expect(patches()).toEqual([
        ['/api/pantry/pantry-rice', { quantity: 0 }],
        ['/api/pantry/pantry-rice', { quantity: 200 }],
      ]),
    )
  })

  it('sends "have some" when a row that had no count goes back on', async () => {
    const bread = row('Bread')
    renderList([bread])
    const control = screen.getByRole('switch', { name: 'Have it: Bread' })

    await userEvent.click(control)
    await userEvent.click(control)

    expect(control).toBeChecked()
    await waitFor(() =>
      expect(patches()).toEqual([
        ['/api/pantry/pantry-bread', { quantity: 0 }],
        ['/api/pantry/pantry-bread', { quantity: null }],
      ]),
    )
  })

  it('turns the switch back on and says so when the request fails', async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: 'x' }), { status: 500 }),
    )
    renderList([rice])
    const control = screen.getByRole('switch', { name: 'Have it: Rice' })

    await userEvent.click(control)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(control).toBeChecked()
    // One herb row may have changed, so Today reads the pantry again.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })
})

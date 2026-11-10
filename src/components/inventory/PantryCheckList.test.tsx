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
import etMessages from '../../../messages/et.json'
import { PantryCheckList, type PantryCheckRow } from './PantryCheckList'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const carrot: PantryCheckRow = {
  ingredientId: 'ing-carrot',
  name: 'Carrot',
  displayQuantity: '~20 pcs',
  mealCount: 4,
  neededByDate: '2026-11-03',
  neededByRelative: 'Tuesday',
  pantryRows: [{ id: 'pantry-carrot', quantity: null, low: false }],
  isStaple: false,
  stock: 'haveIt',
}
const garlic: PantryCheckRow = {
  ingredientId: 'ing-garlic',
  name: 'Garlic',
  displayQuantity: '30 g',
  mealCount: 3,
  neededByDate: '2026-11-02',
  neededByRelative: 'tomorrow',
  pantryRows: [{ id: 'pantry-garlic', quantity: null, low: false }],
  isStaple: true,
  stock: 'haveIt',
}
// Kept at home by its own row and by the fresh basil row (HON-1558).
const basil: PantryCheckRow = {
  ingredientId: 'ing-basil',
  name: 'Basil',
  displayQuantity: '20 g',
  mealCount: 2,
  neededByDate: '2026-11-03',
  neededByRelative: 'Tuesday',
  pantryRows: [
    { id: 'pantry-basil', quantity: null, low: false },
    { id: 'pantry-fresh-basil', quantity: null, low: false },
  ],
  isStaple: false,
  stock: 'haveIt',
}

function renderList(items: PantryCheckRow[], locale: 'en' | 'et' = 'en') {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  const tree = (rows: PantryCheckRow[]) => (
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? enMessages : etMessages}>
      <QueryWrapper>
        <PantryCheckList items={rows} />
      </QueryWrapper>
    </NextIntlClientProvider>
  )
  const view = render(tree(items))
  return { ...view, rerenderWith: (rows: PantryCheckRow[]) => view.rerender(tree(rows)) }
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

/** The stock control's part on the item's row. */
const part = (name: string, label: string) =>
  within(screen.getByRole('radiogroup', { name: `Stock: ${name}` })).getByRole('radio', {
    name: label,
  })

describe('PantryCheckList', () => {
  it('lists the items by first needed date, then name, with amount, meal count and date', () => {
    renderList([carrot, garlic, basil])

    const list = screen.getByRole('list', { name: 'Enough at home?' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Garlic30 g · 3 meals · tomorrowHave itLowRan out',
      'Basil20 g · 2 meals · TuesdayHave itLowRan out',
      'Carrot~20 pcs · 4 meals · TuesdayHave itLowRan out',
    ])
  })

  it('shows the name, the meta line and the stock control as three lines, the name not truncated', () => {
    renderList([carrot])

    const row = screen.getByRole('listitem')
    const lines = [...row.children]
    expect(lines.map((line) => line.textContent)).toEqual([
      'Carrot',
      '~20 pcs · 4 meals · Tuesday',
      'Have itLowRan out',
    ])
    expect(screen.getByText('Carrot')).not.toHaveClass('truncate')
  })

  it('takes its name from a title outside it, and then shows no Caption of its own', () => {
    const { wrapper: QueryWrapper } = createQueryWrapper()
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <QueryWrapper>
          <div id="title">Card title</div>
          <PantryCheckList items={[carrot]} labelledBy="title" />
        </QueryWrapper>
      </NextIntlClientProvider>,
    )

    expect(screen.getByRole('list', { name: 'Card title' })).toBeInTheDocument()
    expect(screen.queryByText('Enough at home?')).not.toBeInTheDocument()
  })

  it('marks a staple with the star, and only a staple', () => {
    renderList([carrot, garlic])

    expect(screen.getAllByRole('img', { name: 'Staple' })).toHaveLength(1)
    const garlicRow = screen.getByRole('radiogroup', { name: 'Stock: Garlic' }).closest('li')!
    expect(within(garlicRow).getByRole('img', { name: 'Staple' })).toBeInTheDocument()
  })

  it('renders in Estonian with the plural meal count', () => {
    renderList(
      [{ ...carrot, name: 'porgand', displayQuantity: '~20 tk', neededByRelative: 'homme' }],
      'et',
    )

    expect(screen.getByRole('list', { name: 'Kas kodus jätkub?' })).toHaveTextContent(
      'porgand~20 tk · 4 toitu · hommeOlemasVäheOtsas',
    )
  })

  it('renders nothing when the check is empty', () => {
    const { container } = renderList([])

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Enough at home?')).not.toBeInTheDocument()
  })

  it('presses the part the server stock says', () => {
    renderList([{ ...carrot, stock: 'low' }, { ...garlic, stock: 'ranOut' }, basil])

    expect(part('Carrot', 'Low')).toHaveAttribute('aria-checked', 'true')
    expect(part('Garlic', 'Ran out')).toHaveAttribute('aria-checked', 'true')
    expect(part('Basil', 'Have it')).toHaveAttribute('aria-checked', 'true')
  })

  it('writes every pantry row of a herb on Low, presses it at once, then refreshes', async () => {
    renderList([basil])

    await userEvent.click(part('Basil', 'Low'))

    expect(part('Basil', 'Low')).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(patches()).toEqual([
      ['/api/pantry/pantry-basil', { low: true }],
      ['/api/pantry/pantry-fresh-basil', { low: true }],
    ])
  })

  it('sets every row to 0 on Ran out', async () => {
    renderList([basil])

    await userEvent.click(part('Basil', 'Ran out'))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(patches()).toEqual([
      ['/api/pantry/pantry-basil', { quantity: 0 }],
      ['/api/pantry/pantry-fresh-basil', { quantity: 0 }],
    ])
  })

  it('sets the row back to "have some" on Have it after Ran out', async () => {
    renderList([
      {
        ...carrot,
        pantryRows: [{ id: 'pantry-carrot', quantity: 0, low: false }],
        stock: 'ranOut',
      },
    ])

    await userEvent.click(part('Carrot', 'Have it'))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(patches()).toEqual([['/api/pantry/pantry-carrot', { quantity: null, low: false }]])
  })

  it('leaves a herb row at 0 alone on Low while the other row keeps the need at home', async () => {
    renderList([
      {
        ...basil,
        pantryRows: [
          { id: 'pantry-basil', quantity: null, low: false },
          { id: 'pantry-fresh-basil', quantity: 0, low: false },
        ],
      },
    ])

    await userEvent.click(part('Basil', 'Low'))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(patches()).toEqual([['/api/pantry/pantry-basil', { low: true }]])
  })

  it('writes both herb rows on Have it when both are at 0', async () => {
    renderList([
      {
        ...basil,
        pantryRows: [
          { id: 'pantry-basil', quantity: 0, low: false },
          { id: 'pantry-fresh-basil', quantity: 0, low: false },
        ],
        stock: 'ranOut',
      },
    ])

    await userEvent.click(part('Basil', 'Have it'))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(patches()).toEqual([
      ['/api/pantry/pantry-basil', { quantity: null, low: false }],
      ['/api/pantry/pantry-fresh-basil', { quantity: null, low: false }],
    ])
  })

  it('keeps the pressed part through the refresh, and follows the server after it', async () => {
    const { rerenderWith } = renderList([carrot])

    await userEvent.click(part('Carrot', 'Low'))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    // The refresh: the server now says low.
    rerenderWith([{ ...carrot, stock: 'low' }])
    expect(part('Carrot', 'Low')).toHaveAttribute('aria-checked', 'true')

    // A later change elsewhere: the row shows what the server says.
    rerenderWith([{ ...carrot, stock: 'ranOut' }])
    expect(part('Carrot', 'Ran out')).toHaveAttribute('aria-checked', 'true')
  })

  it('sends every row of a herb and refreshes when one of them fails', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('pantry-fresh-basil')
        ? new Response('{}', { status: 500 })
        : new Response('{}', { status: 200 }),
    )
    renderList([basil])

    await userEvent.click(part('Basil', 'Ran out'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(patches()).toEqual([
      ['/api/pantry/pantry-basil', { quantity: 0 }],
      ['/api/pantry/pantry-fresh-basil', { quantity: 0 }],
    ])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps focus on the pressed part', async () => {
    renderList([carrot])

    await userEvent.click(part('Carrot', 'Low'))

    expect(part('Carrot', 'Low')).toHaveFocus()
  })

  it('puts the part back and says so when the request fails', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }))
    renderList([carrot])

    await userEvent.click(part('Carrot', 'Ran out'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(part('Carrot', 'Have it')).toHaveAttribute('aria-checked', 'true')
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

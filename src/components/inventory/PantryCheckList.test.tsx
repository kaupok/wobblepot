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
  pantryRows: [{ id: 'pantry-carrot', quantity: null }],
  isStaple: false,
}
const garlic: PantryCheckRow = {
  ingredientId: 'ing-garlic',
  name: 'Garlic',
  displayQuantity: '30 g',
  mealCount: 3,
  neededByDate: '2026-11-02',
  neededByRelative: 'tomorrow',
  pantryRows: [{ id: 'pantry-garlic', quantity: null }],
  isStaple: true,
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
    { id: 'pantry-basil', quantity: null },
    { id: 'pantry-fresh-basil', quantity: null },
  ],
  isStaple: false,
}

const onQuantitiesChanged = vi.fn()

function renderList(items: PantryCheckRow[], locale: 'en' | 'et' = 'en') {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  const tree = (rows: PantryCheckRow[]) => (
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? enMessages : etMessages}>
      <QueryWrapper>
        <PantryCheckList items={rows} onQuantitiesChanged={onQuantitiesChanged} />
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

describe('PantryCheckList', () => {
  it('lists the items by first needed date, then name, with amount, meal count and date', () => {
    renderList([carrot, garlic, basil])

    const list = screen.getByRole('list', { name: 'Enough at home?' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'GarlicAdd to list30 g · 3 meals · tomorrow',
      'BasilAdd to list20 g · 2 meals · Tuesday',
      'CarrotAdd to list~20 pcs · 4 meals · Tuesday',
    ])
  })

  it('marks a staple with the star, and only a staple', () => {
    renderList([carrot, garlic])

    expect(screen.getAllByRole('img', { name: 'Staple' })).toHaveLength(1)
    const garlicRow = screen.getByRole('button', { name: 'Add to list: Garlic' }).closest('li')!
    expect(within(garlicRow).getByRole('img', { name: 'Staple' })).toBeInTheDocument()
  })

  it('renders in Estonian with the plural meal count', () => {
    renderList(
      [{ ...carrot, name: 'porgand', displayQuantity: '~20 tk', neededByRelative: 'homme' }],
      'et',
    )

    expect(screen.getByRole('list', { name: 'Kas kodus jätkub?' })).toHaveTextContent(
      'porgandLisa nimekirja~20 tk · 4 toitu · homme',
    )
    expect(screen.getByRole('button', { name: 'Lisa nimekirja: porgand' })).toBeInTheDocument()
  })

  it('renders nothing when the check is empty', () => {
    const { container } = renderList([])

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Enough at home?')).not.toBeInTheDocument()
  })

  it('sets every pantry row to 0 on Add to list, then refreshes', async () => {
    renderList([basil])

    await userEvent.click(screen.getByRole('button', { name: 'Add to list: Basil' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(patches()).toEqual([
      ['/api/pantry/pantry-basil', { quantity: 0 }],
      ['/api/pantry/pantry-fresh-basil', { quantity: 0 }],
    ])
  })

  it('keeps an added row the server dropped as Added, and Undo writes "have some" back', async () => {
    const { rerenderWith } = renderList([basil, carrot])

    await userEvent.click(screen.getByRole('button', { name: 'Add to list: Basil' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    // The refresh: basil is no longer "have some", so it leaves the check.
    rerenderWith([carrot])

    const basilRow = screen.getByRole('button', { name: 'Undo: Basil' }).closest('li')!
    expect(basilRow).toHaveTextContent('BasilUndoAdded · 20 g · 2 meals · Tuesday')
    fetchMock.mockClear()

    await userEvent.click(screen.getByRole('button', { name: 'Undo: Basil' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    expect(patches()).toEqual([
      ['/api/pantry/pantry-basil', { quantity: null }],
      ['/api/pantry/pantry-fresh-basil', { quantity: null }],
    ])
    expect(screen.getByRole('button', { name: 'Add to list: Basil' })).toBeInTheDocument()
  })

  it('reports the rows each request wrote, for the pantry column', async () => {
    renderList([basil])

    await userEvent.click(screen.getByRole('button', { name: 'Add to list: Basil' }))
    await waitFor(() =>
      expect(onQuantitiesChanged).toHaveBeenCalledWith([
        { id: 'pantry-basil', quantity: 0 },
        { id: 'pantry-fresh-basil', quantity: 0 },
      ]),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Undo: Basil' }))
    await waitFor(() =>
      expect(onQuantitiesChanged).toHaveBeenLastCalledWith([
        { id: 'pantry-basil', quantity: null },
        { id: 'pantry-fresh-basil', quantity: null },
      ]),
    )
  })

  it('keeps the row when Undo is pressed before the Add refresh lands', async () => {
    const { rerenderWith } = renderList([basil, carrot])

    await userEvent.click(screen.getByRole('button', { name: 'Add to list: Basil' }))
    await userEvent.click(screen.getByRole('button', { name: 'Undo: Basil' }))
    // The Add's refresh: the server holds basil at 0, so the check drops it.
    rerenderWith([carrot])

    expect(screen.getByRole('button', { name: 'Add to list: Basil' })).toHaveFocus()
  })

  it('moves focus to Undo after Add to list, and back after Undo', async () => {
    renderList([carrot])

    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Add to list: Carrot' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Undo: Carrot' })).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Add to list: Carrot' })).toHaveFocus()
  })

  it('puts the row back and says so when the request fails', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }))
    renderList([carrot])

    await userEvent.click(screen.getByRole('button', { name: 'Add to list: Carrot' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update item'))
    expect(screen.getByRole('button', { name: 'Add to list: Carrot' })).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

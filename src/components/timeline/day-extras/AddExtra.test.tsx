import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { createQueryWrapper } from '@/test/query-wrapper'
import { extraSearchResults } from '@/stories/day-extra-fixtures'
import { AddExtra } from './AddExtra'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

let requests: { method: string; url: string; body: unknown }[]
let addResponse: [number, unknown]

beforeEach(() => {
  requests = []
  addResponse = [201, { id: 'extra-new' }]
  refresh.mockClear()
  vi.mocked(toast.error).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      const search = url.startsWith('/api/ingredients')
        ? new URL(url, 'http://localhost').searchParams.get('search')!.toLowerCase()
        : null
      const [status, body] =
        search !== null
          ? [
              200,
              {
                ingredients: extraSearchResults.filter((i) =>
                  i.name.toLowerCase().includes(search),
                ),
              },
            ]
          : addResponse
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function openPicker() {
  const { wrapper: Wrapper } = createQueryWrapper()
  const user = userEvent.setup()
  render(
    <Wrapper>
      <AddExtra date="2026-10-17" dayLabel="Saturday Oct 17" />
    </Wrapper>,
  )
  const button = screen.getByRole('button', { name: 'Add an extra: Saturday Oct 17' })
  expect(button).toHaveTextContent('Extra')
  await user.click(button)
  const dialog = within(screen.getByRole('dialog', { name: 'Add an extra' }))
  return { dialog, user, button }
}

const posts = () => requests.filter((r) => r.method === 'POST')

describe('AddExtra', () => {
  it('adds a catalogue ingredient with its amount', async () => {
    const { dialog, user } = await openPicker()

    await user.type(dialog.getByLabelText('Search for an ingredient'), 'wine')
    await user.click(await dialog.findByRole('button', { name: 'Pick: Red wine' }))
    // Red wine is measured by volume, so the amount is in millilitres.
    expect(dialog.getByText('ml')).toBeInTheDocument()
    await user.type(dialog.getByLabelText('Amount (optional)'), '750')
    await user.click(dialog.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(posts()).toEqual([
      {
        method: 'POST',
        url: '/api/extras',
        body: { date: '2026-10-17', ingredientId: 'ing-wine', quantity: 750 },
      },
    ])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('adds an ingredient with no amount', async () => {
    const { dialog, user } = await openPicker()

    await user.type(dialog.getByLabelText('Search for an ingredient'), 'egg')
    await user.click(await dialog.findByRole('button', { name: 'Pick: Eggs' }))
    expect(dialog.getByText('pc')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0]!.body).toEqual({
      date: '2026-10-17',
      ingredientId: 'ing-eggs',
      quantity: null,
    })
  })

  it('adds the search words as free text when nothing matches', async () => {
    const { dialog, user } = await openPicker()

    await user.type(dialog.getByLabelText('Search for an ingredient'), ' chips ')
    expect(await dialog.findByText('No ingredient matches "chips".')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Add "chips" as text' }))

    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0]!.body).toEqual({ date: '2026-10-17', label: 'chips' })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('offers free text beside the matches too', async () => {
    const { dialog, user } = await openPicker()

    await user.type(dialog.getByLabelText('Search for an ingredient'), 'wine')
    await dialog.findByRole('button', { name: 'Pick: Red wine' })

    expect(dialog.getByRole('button', { name: 'Add "wine" as text' })).toBeInTheDocument()
  })

  it('goes back to the search with "Pick another"', async () => {
    const { dialog, user } = await openPicker()

    await user.type(dialog.getByLabelText('Search for an ingredient'), 'wine')
    await user.click(await dialog.findByRole('button', { name: 'Pick: Red wine' }))
    await user.click(dialog.getByRole('button', { name: 'Pick another' }))

    expect(dialog.getByLabelText('Search for an ingredient')).toBeInTheDocument()
    expect(posts()).toEqual([])
  })

  it('says the day has passed when the route refuses a past date', async () => {
    addResponse = [400, { error: 'Cannot add an extra to a past day', code: 'past_date' }]
    const { dialog, user } = await openPicker()

    await user.type(dialog.getByLabelText('Search for an ingredient'), 'chips')
    await user.click(await dialog.findByRole('button', { name: 'Add "chips" as text' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This day has passed. Refresh the page to see today.',
      ),
    )
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows catalog copy, not the route error, on any other failure', async () => {
    addResponse = [500, { error: 'Failed to add extra' }]
    const { dialog, user } = await openPicker()

    await user.type(dialog.getByLabelText('Search for an ingredient'), 'chips')
    await user.click(await dialog.findByRole('button', { name: 'Add "chips" as text' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't add the extra. Please try again."),
    )
  })

  it('returns focus to "+ Extra" when it closes', async () => {
    const { dialog, user, button } = await openPicker()

    await user.click(dialog.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(button).toHaveFocus())
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { createQueryWrapper } from '@/test/query-wrapper'
import { chipsExtra, mixedExtras, wineExtra } from '@/stories/day-extra-fixtures'
import { DayExtrasRow } from './DayExtrasRow'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

let requests: { method: string; url: string; body: unknown }[]
let status: number

beforeEach(() => {
  requests = []
  status = 200
  refresh.mockClear()
  vi.mocked(toast.error).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(
        method === 'DELETE' && status === 200
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify(status === 200 ? {} : { error: 'Refused' }), {
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

function renderRow(extras = mixedExtras) {
  const onRemoved = vi.fn()
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <DayExtrasRow extras={extras} onRemoved={onRemoved} />
    </Wrapper>,
  )
  return { onRemoved, user: userEvent.setup() }
}

describe('DayExtrasRow', () => {
  it('renders nothing for a day with no extras', () => {
    const { wrapper: Wrapper } = createQueryWrapper()
    const { container } = render(
      <Wrapper>
        <DayExtrasRow extras={[]} />
      </Wrapper>,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('lists each extra with its amount, under "Extras"', () => {
    renderRow()

    const list = screen.getByRole('list', { name: 'Extras' })
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Red wine 750ml', 'chips', 'Eggs'])
  })

  it("changes an ingredient extra's amount", async () => {
    const { user } = renderRow()

    await user.click(screen.getByRole('button', { name: 'Edit extra: Red wine 750ml' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Red wine' }))
    const amount = dialog.getByLabelText('Amount (optional)')
    expect(amount).toHaveValue('750')
    await user.clear(amount)
    await user.type(amount, '1500')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(requests).toEqual([
      { method: 'PATCH', url: '/api/extras/extra-wine', body: { quantity: 1500 } },
    ])
  })

  it('clears the amount when the field is emptied', async () => {
    const { user } = renderRow([wineExtra])

    await user.click(screen.getByRole('button', { name: 'Edit extra: Red wine 750ml' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.clear(dialog.getByLabelText('Amount (optional)'))
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]!.body).toEqual({ quantity: null })
  })

  it('removes an extra and hands focus to the day', async () => {
    const { user, onRemoved } = renderRow()

    await user.click(screen.getByRole('button', { name: 'Edit extra: chips' }))
    const dialog = within(screen.getByRole('dialog', { name: 'chips' }))
    // Free text has no amount to change.
    expect(dialog.queryByLabelText('Amount (optional)')).not.toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1))
    expect(requests).toEqual([{ method: 'DELETE', url: '/api/extras/extra-chips', body: null }])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('returns focus to the extra when the dialog closes without a removal', async () => {
    const { user, onRemoved } = renderRow([chipsExtra])
    const button = screen.getByRole('button', { name: 'Edit extra: chips' })

    await user.click(button)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(button).toHaveFocus())
    expect(onRemoved).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and shows catalog copy when Remove fails', async () => {
    status = 500
    const { user, onRemoved } = renderRow([chipsExtra])

    await user.click(screen.getByRole('button', { name: 'Edit extra: chips' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't remove the extra. Please try again."),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onRemoved).not.toHaveBeenCalled()
  })
})

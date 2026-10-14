import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { apiFetch, ApiError } from '@/lib/api'
import { dropFocusToBody } from '@/test/focus'
import { createQueryWrapper } from '@/test/query-wrapper'
import { ApiKeysSection, type ApiKeyRow } from './ApiKeysSection'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiFetch: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const KITCHEN: ApiKeyRow = {
  id: 'key-kitchen',
  name: 'Kitchen screen',
  start: 'wp_Ab3dEf',
  createdAt: '2026-10-02T18:00:00.000Z',
  lastUsedAt: '2026-10-13T07:15:00.000Z',
}
const SCRIPT: ApiKeyRow = {
  id: 'key-script',
  name: 'Shopping script',
  start: 'wp_Zx9yWv',
  createdAt: '2026-10-05T09:30:00.000Z',
  lastUsedAt: null,
}
const NEW_KEY = 'wp_Qr7sTuVwXyZ0123456789abcdefghij'

const mockApiFetch = vi.mocked(apiFetch)

function renderSection(keys: ApiKeyRow[]) {
  return render(<ApiKeysSection initialKeys={keys} />, {
    wrapper: createQueryWrapper().wrapper,
  })
}

describe('ApiKeysSection (HON-1220)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('says there are no keys when the list is empty', () => {
    mockApiFetch.mockResolvedValue([])
    renderSection([])

    expect(
      screen.getByRole('heading', { level: 2, name: 'Screens and scripts' }),
    ).toBeInTheDocument()
    expect(screen.getByText('You have no keys.')).toBeInTheDocument()
  })

  it("shows each key's name, start, creation date and last use", () => {
    mockApiFetch.mockResolvedValue([KITCHEN, SCRIPT])
    renderSection([KITCHEN, SCRIPT])

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('Kitchen screen')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('wp_Ab3dEf…')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Created: October 2, 2026')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Last used: October 13, 2026')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Not used yet')).toBeInTheDocument()
  })

  it('creates a key, shows it once with focus on it, and Done returns to the name field', async () => {
    const user = userEvent.setup()
    let rows: ApiKeyRow[] = []
    const created: ApiKeyRow = {
      ...SCRIPT,
      id: 'key-new',
      name: 'Kitchen screen',
      start: 'wp_Qr7sTu',
    }
    mockApiFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        rows = [created]
        return { key: NEW_KEY, apiKey: created }
      }
      return rows
    })
    renderSection([])

    await user.type(screen.getByLabelText('Key name'), '  Kitchen screen ')
    await user.click(screen.getByRole('button', { name: 'Create key' }))

    expect(mockApiFetch).toHaveBeenCalledWith('/api/auth/user/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Kitchen screen' }),
    })
    const heading = await screen.findByRole('heading', { name: 'New key: Kitchen screen' })
    await waitFor(() => expect(heading.parentElement).toHaveFocus())
    expect(screen.getByText(NEW_KEY)).toBeInTheDocument()
    expect(
      screen.getByText('Copy the key now. Wobblepot does not show it again.'),
    ).toBeInTheDocument()
    expect(within(screen.getByRole('list')).getByText('wp_Qr7sTu…')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.queryByText(NEW_KEY)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Key name')).toHaveFocus())
    expect(screen.getByLabelText('Key name')).toHaveValue('')
  })

  it('copies the new key', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mockApiFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? { key: NEW_KEY, apiKey: SCRIPT } : [SCRIPT],
    )
    renderSection([])

    await user.type(screen.getByLabelText('Key name'), 'Shopping script')
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    await user.click(await screen.findByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith(NEW_KEY)
    expect(toast.success).toHaveBeenCalledWith('Key copied')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('asks for a name without calling the route', async () => {
    const user = userEvent.setup()
    mockApiFetch.mockResolvedValue([])
    renderSection([])

    await user.click(screen.getByRole('button', { name: 'Create key' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name for the key.')
    expect(screen.getByLabelText('Key name')).toHaveAttribute('aria-invalid', 'true')
    expect(mockApiFetch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('shows the translated limit message for an 11th key and returns focus to Create', async () => {
    const user = userEvent.setup()
    let reject!: (error: unknown) => void
    mockApiFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Promise((_resolve, r) => (reject = r))
      return []
    })
    renderSection([])

    await user.type(screen.getByLabelText('Key name'), 'One too many')
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled())
    dropFocusToBody()

    await act(async () =>
      reject(new ApiError('Too many API keys', 400, { code: 'key_limit', body: {} })),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You have 10 keys, the most you can have. Revoke one to create another.',
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create key' })).toHaveFocus())
  })

  it('shows catalog copy, not the server text, when Create fails', async () => {
    const user = userEvent.setup()
    mockApiFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new ApiError('Failed to create the API key', 500)
      return []
    })
    renderSection([])

    await user.type(screen.getByLabelText('Key name'), 'Kitchen screen')
    await user.click(screen.getByRole('button', { name: 'Create key' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The key was not created. Try again.',
    )
  })

  it('asks first, then revokes through the DELETE route and removes the row', async () => {
    const user = userEvent.setup()
    let rows = [KITCHEN, SCRIPT]
    mockApiFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        rows = [SCRIPT]
        return undefined
      }
      return rows
    })
    renderSection([KITCHEN, SCRIPT])

    await user.click(screen.getByRole('button', { name: 'Revoke: Kitchen screen' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Revoke Kitchen screen?' })
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(screen.queryByText('Kitchen screen')).not.toBeInTheDocument())
    expect(mockApiFetch).toHaveBeenCalledWith('/api/auth/user/api-keys/key-kitchen', {
      method: 'DELETE',
    })
    expect(toast.success).toHaveBeenCalledWith('Revoked: Kitchen screen')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Your keys' }).parentElement).toHaveFocus(),
    )
  })

  it('keeps the row and shows catalog copy when Revoke fails', async () => {
    const user = userEvent.setup()
    mockApiFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') throw new Error('Failed to revoke the API key')
      return [KITCHEN]
    })
    renderSection([KITCHEN])

    await user.click(screen.getByRole('button', { name: 'Revoke: Kitchen screen' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('The key was not revoked. Try again.'),
    )
    expect(screen.getByText('Kitchen screen')).toBeInTheDocument()
  })
})

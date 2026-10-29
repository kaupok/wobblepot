import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { track } from '@/lib/analytics'
import { ApiError, apiFetch } from '@/lib/api'
import { dropFocusToBody } from '@/test/focus'
import { createQueryWrapper } from '@/test/query-wrapper'

import { type ApiKeyRow, ApiKeysSection } from './ApiKeysSection'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiFetch: vi.fn(),
}))

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const KITCHEN: ApiKeyRow = {
  id: 'key-kitchen',
  name: 'Kitchen screen',
  start: 'wp_Ab3dEf',
  createdAt: '2026-10-02T18:00:00.000Z',
  lastUsedAt: '2026-10-13T07:15:00.000Z',
  expiresAt: null,
  expired: false,
  memberName: null,
}
const SCRIPT: ApiKeyRow = {
  id: 'key-script',
  name: 'Shopping script',
  start: 'wp_Zx9yWv',
  createdAt: '2026-10-05T09:30:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
  expired: false,
  memberName: null,
}
const NEW_KEY = 'wp_Qr7sTuVwXyZ0123456789abcdefghij'

const mockApiFetch = vi.mocked(apiFetch)

function renderSection(keys: ApiKeyRow[], { householdView = false } = {}) {
  return render(
    <ApiKeysSection
      initialKeys={keys}
      timeZone="Europe/Tallinn"
      householdView={householdView}
      baseUrl="https://wobblepot.com"
    />,
    { wrapper: createQueryWrapper().wrapper },
  )
}

/** The key rows only: "Use the key" has list items of its own (HON-1228). */
function keyRows() {
  return within(screen.getByRole('list', { name: /^(Your|Household) keys$/ })).getAllByRole(
    'listitem',
  )
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

    const rows = keyRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('Kitchen screen')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('wp_Ab3dEf…')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Created: October 2, 2026')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Last used: October 13, 2026')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Not used yet')).toBeInTheDocument()
  })

  it("prints dates in the household's timezone, not the runtime's", () => {
    // 22:30 UTC on 13 October is already 14 October in Tallinn.
    const lateUse = { ...KITCHEN, lastUsedAt: '2026-10-13T22:30:00.000Z' }
    mockApiFetch.mockResolvedValue([lateUse])
    renderSection([lateUse])

    expect(screen.getByText('Last used: October 14, 2026')).toBeInTheDocument()
  })

  it('creates a key, shows it once with focus on it, and Done returns to the name field', async () => {
    const user = userEvent.setup()
    const created: ApiKeyRow = {
      ...SCRIPT,
      id: 'key-new',
      name: 'Kitchen screen',
      start: 'wp_Qr7sTu',
    }
    let posted = false
    mockApiFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted = true
        return { key: NEW_KEY, apiKey: created }
      }
      // The refetch after Create never lands: Done must not wait for it.
      return posted ? new Promise(() => {}) : []
    })
    renderSection([])

    await user.type(screen.getByLabelText('Key name'), '  Kitchen screen ')
    await user.click(screen.getByRole('button', { name: 'Create key' }))

    expect(mockApiFetch).toHaveBeenCalledWith('/api/auth/user/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Kitchen screen', expiresInDays: null }),
    })
    const heading = await screen.findByRole('heading', { name: 'New key: Kitchen screen' })
    await waitFor(() => expect(heading.parentElement).toHaveFocus())
    expect(screen.getByText(NEW_KEY)).toBeInTheDocument()
    expect(
      screen.getByText('Copy the key now. Wobblepot does not show it again.'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Your keys' })).getByText('wp_Qr7sTu…'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.queryByText(NEW_KEY)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Key name')).toBeEnabled()
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

  // HON-1221: optional expiry.
  it('sends the expiry in days with the name', async () => {
    const user = userEvent.setup()
    mockApiFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? { key: NEW_KEY, apiKey: { ...SCRIPT, id: 'key-new' } } : [],
    )
    renderSection([])

    await user.type(screen.getByLabelText('Key name'), 'Kitchen screen')
    await user.type(screen.getByLabelText('Expires in (optional)'), '30')
    await user.click(screen.getByRole('button', { name: 'Create key' }))

    expect(mockApiFetch).toHaveBeenCalledWith('/api/auth/user/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Kitchen screen', expiresInDays: 30 }),
    })
  })

  it.each(['0', '366', '1,5', 'week'])(
    'refuses an expiry of %s without calling the route',
    async (typed) => {
      const user = userEvent.setup()
      mockApiFetch.mockResolvedValue([])
      renderSection([])

      await user.type(screen.getByLabelText('Key name'), 'Kitchen screen')
      await user.type(screen.getByLabelText('Expires in (optional)'), typed)
      await user.click(screen.getByRole('button', { name: 'Create key' }))

      expect(screen.getByText('Enter a whole number of days from 1 to 365.')).toBeInTheDocument()
      expect(screen.getByLabelText('Expires in (optional)')).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText('Expires in (optional)')).toHaveFocus()
      expect(mockApiFetch).not.toHaveBeenCalledWith('/api/auth/user/api-keys', expect.anything())
    },
  )

  it('shows the expiry date, and "Expired" once it is past', () => {
    const expiring = { ...KITCHEN, expiresAt: '2026-11-13T07:15:00.000Z' }
    const expired = { ...SCRIPT, expiresAt: '2026-10-06T09:30:00.000Z', expired: true }
    mockApiFetch.mockResolvedValue([expiring, expired])
    renderSection([expiring, expired])

    const rows = keyRows()
    expect(within(rows[0]!).getByText('Expires: November 13, 2026')).toBeInTheDocument()
    expect(within(rows[0]!).queryByText('Expired')).not.toBeInTheDocument()
    expect(within(rows[1]!).getByText('Expired')).toBeInTheDocument()
    expect(within(rows[1]!).queryByText(/^Expires:/)).not.toBeInTheDocument()
  })

  // HON-1221: the owner's household view.
  describe('household view', () => {
    const JANE_KEY = { ...KITCHEN, memberName: 'Jane' }
    const OWN_KEY = { ...SCRIPT, memberName: 'Henri' }

    it("names the list for the household and each key's member", () => {
      mockApiFetch.mockResolvedValue([JANE_KEY, OWN_KEY])
      renderSection([JANE_KEY, OWN_KEY], { householdView: true })

      expect(screen.getByRole('heading', { name: 'Household keys' })).toBeInTheDocument()
      const rows = keyRows()
      expect(within(rows[0]!).getByText('Member: Jane')).toBeInTheDocument()
      expect(within(rows[1]!).getByText('Member: Henri')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Revoke: Kitchen screen, Jane' }),
      ).toBeInTheDocument()
    })

    it("adds the owner's new key from the refetch, with its member", async () => {
      const user = userEvent.setup()
      const fromPost: ApiKeyRow = { ...SCRIPT, id: 'key-new', name: 'Desk screen' }
      let release: () => void = () => {}
      const refetched = new Promise<void>((resolve) => (release = resolve))
      let posted = false
      mockApiFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posted = true
          return { key: NEW_KEY, apiKey: fromPost }
        }
        if (!posted) return []
        await refetched
        return [{ ...fromPost, memberName: 'Henri' }]
      })
      renderSection([], { householdView: true })

      await user.type(screen.getByLabelText('Key name'), 'Desk screen')
      await user.click(screen.getByRole('button', { name: 'Create key' }))
      await screen.findByRole('heading', { name: 'New key: Desk screen' })

      // Before the refetch, the POST's row (no member) is not in the list.
      expect(screen.queryByRole('button', { name: /^Revoke: Desk screen/ })).toBeNull()

      release()
      expect(
        await screen.findByRole('button', { name: 'Revoke: Desk screen, Henri' }),
      ).toBeInTheDocument()
      expect(screen.getByText('Member: Henri')).toBeInTheDocument()
    })

    it('says no one in the household has a key', () => {
      mockApiFetch.mockResolvedValue([])
      renderSection([], { householdView: true })

      expect(screen.getByText('No one in the household has a key.')).toBeInTheDocument()
    })

    it("revokes a member's key", async () => {
      const user = userEvent.setup()
      let rows: ApiKeyRow[] = [JANE_KEY]
      mockApiFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          rows = []
          return undefined
        }
        return rows
      })
      renderSection([JANE_KEY], { householdView: true })

      await user.click(screen.getByRole('button', { name: 'Revoke: Kitchen screen, Jane' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Revoke Kitchen screen?' })
      await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

      await waitFor(() =>
        expect(screen.getByText('No one in the household has a key.')).toBeInTheDocument(),
      )
      expect(mockApiFetch).toHaveBeenCalledWith('/api/auth/user/api-keys/key-kitchen', {
        method: 'DELETE',
      })
    })

    it("does not show member names in a member's own list", () => {
      mockApiFetch.mockResolvedValue([JANE_KEY])
      renderSection([JANE_KEY])

      expect(screen.getByRole('heading', { name: 'Your keys' })).toBeInTheDocument()
      expect(screen.queryByText('Member: Jane')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Revoke: Kitchen screen' })).toBeInTheDocument()
    })
  })
})

describe('ApiKeysSection "Use the key" (HON-1228)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockResolvedValue([])
  })

  it('shows both endpoint URLs on the given host, above the key list', () => {
    renderSection([])

    const heading = screen.getByRole('heading', { level: 3, name: 'Use the key' })
    expect(screen.getByText('https://wobblepot.com/api/v1/meal-plan')).toBeInTheDocument()
    expect(screen.getByText('https://wobblepot.com/api/v1/shopping-list')).toBeInTheDocument()
    expect(screen.getByText('Authorization: Bearer wp_…')).toBeInTheDocument()
    const listHeading = screen.getByRole('heading', { name: 'Your keys' })
    expect(heading.compareDocumentPosition(listHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('stays between the new key and the key list while the new key shows', async () => {
    const user = userEvent.setup()
    mockApiFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? { key: NEW_KEY, apiKey: KITCHEN } : [],
    )
    renderSection([])

    await user.type(screen.getByLabelText('Key name'), 'Kitchen screen')
    await user.click(screen.getByRole('button', { name: 'Create key' }))

    const newKey = await screen.findByRole('heading', { name: 'New key: Kitchen screen' })
    const guide = screen.getByRole('heading', { name: 'Use the key' })
    const list = screen.getByRole('heading', { name: 'Your keys' })
    expect(newKey.compareDocumentPosition(guide)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(guide.compareDocumentPosition(list)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('copies the meal plan URL and captures api_key:guide_copied', async () => {
    const user = userEvent.setup()
    renderSection([])

    await user.click(screen.getByRole('button', { name: 'Copy: Meal plan URL' }))

    expect(await navigator.clipboard.readText()).toBe('https://wobblepot.com/api/v1/meal-plan')
    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('api_key:guide_copied', { item: 'meal-plan' })
    expect(toast.success).toHaveBeenCalledWith('URL copied')
    expect(screen.getByRole('button', { name: 'Copied: Meal plan URL' })).toHaveTextContent(
      'Copied',
    )
  })

  it('copies the shopping list URL', async () => {
    const user = userEvent.setup()
    renderSection([])

    await user.click(screen.getByRole('button', { name: 'Copy: Shopping list URL' }))

    expect(await navigator.clipboard.readText()).toBe('https://wobblepot.com/api/v1/shopping-list')
    expect(track).toHaveBeenCalledWith('api_key:guide_copied', { item: 'shopping-list' })
  })

  it('captures nothing when the clipboard refuses', async () => {
    const user = userEvent.setup()
    renderSection([])
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'))

    await user.click(screen.getByRole('button', { name: 'Copy: Meal plan URL' }))

    expect(track).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Not copied. Select the text and copy it by hand.')
  })

  it('keeps the Home Assistant example closed until opened, then copies all of it', async () => {
    const user = userEvent.setup()
    renderSection([])

    const trigger = screen.getByRole('button', { name: 'Home Assistant' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Home Assistant example')).not.toBeInTheDocument()

    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const yaml = screen.getByLabelText('Home Assistant example')
    expect(yaml).toHaveTextContent('resource: https://wobblepot.com/api/v1/meal-plan')
    expect(yaml).toHaveTextContent('scan_interval: 300')

    await user.click(screen.getByRole('button', { name: 'Copy: Home Assistant example' }))

    const copied = await navigator.clipboard.readText()
    expect(copied.startsWith('rest:\n  - resource: https://wobblepot.com/api/v1/meal-plan\n')).toBe(
      true,
    )
    expect(copied).toContain(
      "{{ dinner[0].mealName if dinner and dinner[0].mealName else 'Nothing planned' }}",
    )
    expect(track).toHaveBeenCalledWith('api_key:guide_copied', { item: 'home-assistant' })
    expect(toast.success).toHaveBeenCalledWith('Example copied')
  })

  it('links the full guide on GitHub in a new tab', () => {
    renderSection([])

    const link = screen.getByRole('link', { name: 'Wobblepot read-only API' })
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/kaupok/wobblepot/blob/main/docs/API.md',
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

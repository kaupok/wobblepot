import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { createQueryWrapper } from '@/test/query-wrapper'
import { ConnectedAssistantsList, type ConnectedAssistant } from './ConnectedAssistantsList'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiFetch: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const CLAUDE: ConnectedAssistant = {
  clientId: 'client-claude',
  clientName: 'Claude',
  scopes: ['openid', 'profile', 'offline_access', 'mcp:read', 'mcp:write'],
  createdAt: '2026-10-02T18:00:00.000Z',
}
const UNNAMED: ConnectedAssistant = {
  clientId: 'client-x',
  clientName: null,
  scopes: ['mcp:read'],
  createdAt: null,
}

const mockApiFetch = vi.mocked(apiFetch)

function renderList(consents: ConnectedAssistant[]) {
  return render(<ConnectedAssistantsList initialConsents={consents} timeZone="Europe/Tallinn" />, {
    wrapper: createQueryWrapper().wrapper,
  })
}

describe('ConnectedAssistantsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('says no assistant is connected when the list is empty', () => {
    mockApiFetch.mockResolvedValue([])
    renderList([])

    expect(screen.getByText('No assistant is connected.')).toBeInTheDocument()
  })

  it('shows each assistant with its date and scopes in plain words', () => {
    mockApiFetch.mockResolvedValue([CLAUDE, UNNAMED])
    renderList([CLAUDE, UNNAMED])

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('Claude')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Connected: October 2, 2026')).toBeInTheDocument()
    expect(
      within(rows[0]!).getByText(
        'Reads meal plan, shopping list, pantry, recipes and household settings · Updates shopping list, pantry and meal plan, and adds, changes and deletes recipes · Confirms it is you · Sees your name and profile picture · Stays connected',
      ),
    ).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Unnamed assistant')).toBeInTheDocument()
    expect(within(rows[1]!).queryByText(/^Connected:/)).not.toBeInTheDocument()
  })

  it("prints the date in the household's timezone, not the runtime's", () => {
    // 22:30 UTC on 13 October is already 14 October in Tallinn.
    const lateConsent = { ...CLAUDE, createdAt: '2026-10-13T22:30:00.000Z' }
    mockApiFetch.mockResolvedValue([lateConsent])
    renderList([lateConsent])

    expect(screen.getByText('Connected: October 14, 2026')).toBeInTheDocument()
  })

  it('asks first, then disconnects through the DELETE route and removes the row', async () => {
    const user = userEvent.setup()
    // The server's view: Claude is listed until the DELETE lands.
    let rows = [CLAUDE, UNNAMED]
    mockApiFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        rows = [UNNAMED]
        return undefined
      }
      return rows
    })
    renderList([CLAUDE, UNNAMED])

    await user.click(screen.getByRole('button', { name: 'Disconnect: Claude' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Disconnect Claude?' })
    expect(mockApiFetch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'DELETE' }),
    )

    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(screen.queryByText('Claude')).not.toBeInTheDocument())
    expect(mockApiFetch).toHaveBeenCalledWith('/api/auth/user/mcp-consents/client-claude', {
      method: 'DELETE',
    })
    expect(toast.success).toHaveBeenCalledWith('Disconnected: Claude')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('keeps the row and shows catalog copy when Disconnect fails', async () => {
    const user = userEvent.setup()
    mockApiFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') throw new Error('Failed to disconnect the assistant')
      return [CLAUDE]
    })
    renderList([CLAUDE])

    await user.click(screen.getByRole('button', { name: 'Disconnect: Claude' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('The assistant was not disconnected. Try again.'),
    )
    expect(screen.getByText('Claude')).toBeInTheDocument()
  })

  it('closes on Cancel without calling the route', async () => {
    const user = userEvent.setup()
    mockApiFetch.mockResolvedValue([CLAUDE])
    renderList([CLAUDE])

    await user.click(screen.getByRole('button', { name: 'Disconnect: Claude' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mockApiFetch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

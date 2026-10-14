import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { track } from '@/lib/analytics'
import { McpServerUrl } from './McpServerUrl'

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const URL = 'https://wobblepot.com/api/mcp'

describe('McpServerUrl', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the server URL', () => {
    render(<McpServerUrl url={URL} />)

    expect(screen.getByText(URL)).toBeInTheDocument()
  })

  it('copies the URL and captures mcp:server_url_copied once', async () => {
    const user = userEvent.setup()
    render(<McpServerUrl url={URL} />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await navigator.clipboard.readText()).toBe(URL)
    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('mcp:server_url_copied', { source: 'profile' })
    expect(toast.success).toHaveBeenCalledWith('Server URL copied')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('tells the user and captures nothing when the clipboard refuses', async () => {
    const user = userEvent.setup()
    render(<McpServerUrl url={URL} />)
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'))

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(track).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'The URL was not copied. Select it and copy it by hand.',
    )
  })
})

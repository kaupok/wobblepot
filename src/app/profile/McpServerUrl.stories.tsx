import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { McpServerUrl } from './McpServerUrl'

const meta = {
  title: 'Feature/Profile/McpServerUrl',
  component: McpServerUrl,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The MCP server URL on `/profile` (HON-1153), with Copy. Copy captures `mcp:server_url_copied`, the top of the connect funnel; the capture is asserted in `McpServerUrl.test.tsx`.',
      },
    },
  },
  args: { url: 'https://wobblepot.com/api/mcp' },
} satisfies Meta<typeof McpServerUrl>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A preview deployment's host is long; the URL wraps rather than widening the page. */
export const LongPreviewHost: Story = {
  args: {
    url: 'https://wobblepot-git-kaupo-hon-1153-connect-to-an-ai-assistant-honkadori.vercel.app/api/mcp',
  },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
}

export const Estonian: Story = {
  globals: { locale: 'et' },
}

export const Copied: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The browser may refuse clipboard access in the test runner; stub it.
    const writeText = fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    await userEvent.click(canvas.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://wobblepot.com/api/mcp'))
    await expect(canvas.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  },
}

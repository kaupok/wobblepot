import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
  openViaTrigger,
  pressEscape,
} from '@/stories/a11y-helpers'
import { createMemberInvite } from '@/stories/fixtures'
import { errorInviteHandlers, pendingInviteHandlers } from '@/stories/msw-handlers'
import { MemberInviteDialog } from './MemberInviteDialog'

const meta = {
  title: 'Feature/Household/MemberInviteDialog',
  component: MemberInviteDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Dialog for creating an invite link so a manual member can claim their profile. The active-invite branch shows the link with a copy button; the empty branch lets the owner generate a fresh one. Clipboard write happens via `navigator.clipboard.writeText`.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    memberId: 'member-pending',
    memberName: 'Jordan',
    existingInvite: null,
    onInviteCreated: fn(),
  },
} satisfies Meta<typeof MemberInviteDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {
  args: { open: false },
  parameters: {
    docs: {
      description: {
        story:
          'Dialog closed — verifies the component renders nothing visible when `open` is false.',
      },
    },
  },
}

export const Open: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'No existing invite yet — the dialog shows the explanation and a "Create invite link" CTA.',
      },
    },
  },
}

export const InvitePending: Story = {
  parameters: {
    msw: { handlers: pendingInviteHandlers },
    docs: {
      description: {
        story:
          'After clicking create, the POST never resolves — button stays in the "Creating..." state.',
      },
    },
  },
  play: async () => {
    const body = within(document.body)
    const createButton = await body.findByRole('button', { name: /create invite link/i })
    await userEvent.click(createButton)
    await body.findByRole('button', { name: /creating/i })
  },
}

export const InviteSent: Story = {
  args: {
    existingInvite: createMemberInvite(),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Active invite already exists — dialog shows the link, expiry, and a "Done" footer button.',
      },
    },
  },
}

export const InviteSentEstonian: Story = {
  name: 'Invite sent (Estonian)',
  args: {
    existingInvite: createMemberInvite(),
  },
  globals: { locale: 'et' },
  parameters: {
    docs: {
      description: {
        story:
          'Active invite under the `et` locale — the expiry date renders via the centralized, localized `formatFullDate` helper (HON-546 item 5).',
      },
    },
  },
}

export const Error: Story = {
  parameters: {
    msw: { handlers: errorInviteHandlers },
    docs: {
      description: {
        story: 'POST returns 500 — error message renders below the explanation copy.',
      },
    },
  },
  play: async () => {
    const body = within(document.body)
    const createButton = await body.findByRole('button', { name: /create invite link/i })
    await userEvent.click(createButton)
    await body.findByText(/failed to create invite/i)
  },
}

// Play story — exercises the clipboard contract. The active-invite branch
// renders the copy button; clicking it writes the URL to the clipboard and
// fires the `onInviteCreated` callback only when generating a new link, so the
// copy assertion targets `navigator.clipboard.writeText` directly.

export const CopyInviteLink: Story = {
  args: {
    existingInvite: createMemberInvite({ url: 'https://wobblepot.com/invite/copy-test' }),
  },
  play: async () => {
    const writeText = fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const body = within(document.body)
    const copyButton = await body.findByRole('button', { name: /^copy$/i })
    await userEvent.click(copyButton)

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://wobblepot.com/invite/copy-test'),
    )
    await body.findByRole('button', { name: /copied/i })
  },
}

// Interaction-a11y story — asserts focus trap on open, tab containment, Escape
// handling, and close-sequence completion. See `src/stories/a11y-helpers.ts`.
// Wraps the controlled-open modal in a local trigger-button render so it can be
// opened via keyboard like a real callsite.
export const A11yInteractionPatterns: Story = {
  args: { open: false },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div>
        <button type="button" data-testid="a11y-trigger" onClick={() => setOpen(true)}>
          Open invite dialog
        </button>
        <MemberInviteDialog
          {...args}
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            args.onOpenChange?.(next)
          }}
        />
      </div>
    )
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByTestId('a11y-trigger')

    await openViaTrigger(trigger)
    await assertFocusInDialog()
    await assertTabStaysInDialog()

    await pressEscape()
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
    await awaitDialogClosed()
  },
}

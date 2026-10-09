import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { LeaveHouseholdDialog } from './LeaveHouseholdDialog'

const meta = {
  title: 'Feature/LeaveHouseholdDialog',
  component: LeaveHouseholdDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The Leave household section at the end of `/household` (HON-1133): one line of consequence and a confirm. A member leaves and the household stays. An owner who is the only account holder leaves by deleting the household. An owner with other account holders gets the reason in place of the button.',
      },
    },
  },
  args: {
    householdName: 'Kõrvid',
    isOwner: false,
    accountMemberCount: 1,
  },
} satisfies Meta<typeof LeaveHouseholdDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Member: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A member. The play function opens the confirm, checks the focus trap and tab order, and closes it with Escape.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Leave household' }))
    const dialog = await body.findByRole('alertdialog')
    // The dialog fades in, so wait for it to be visible.
    await waitFor(() =>
      expect(within(dialog).getByText(/Its plan stays with the household/)).toBeVisible(),
    )

    // Focus trap: focus moves into the dialog and Tab never leaves it.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    for (let i = 0; i < 4; i++) {
      await userEvent.keyboard('{Tab}')
      await expect(dialog.contains(document.activeElement)).toBe(true)
    }

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument())
  },
}

export const SoleOwner: Story = {
  args: { isOwner: true, accountMemberCount: 1 },
  parameters: {
    docs: {
      description: {
        story: 'The only account holder: leaving deletes the household, and the confirm says so.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Leave household' }))
    const dialog = await within(document.body).findByRole('alertdialog')
    // The dialog fades in, so wait for it to be visible.
    await waitFor(() => expect(within(dialog).getByText(/This cannot be undone/)).toBeVisible())
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  },
}

export const OwnerWithOtherAccounts: Story = {
  args: { isOwner: true, accountMemberCount: 3 },
  parameters: {
    docs: {
      description: {
        story: 'An owner with two other account holders: the reason, and no button.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument()
    await expect(canvas.getByText(/2 other members have an account/)).toBeVisible()
  },
}

export const LeaveFails: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/households/me/leave', () =>
          HttpResponse.json({ error: 'Failed to leave household' }, { status: 500 }),
        ),
      ],
    },
    docs: {
      description: {
        story: 'The route fails: the dialog stays open with catalog copy, not the route text.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Leave household' }))
    const dialog = await within(document.body).findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave household' }))
    await expect(
      await within(dialog).findByText('Could not leave the household. Try again.'),
    ).toBeVisible()
  },
}

export const Estonian: Story = {
  args: { isOwner: true, accountMemberCount: 1 },
  globals: { locale: 'et' },
}

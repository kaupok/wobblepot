import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { JoinHouseholdCard } from './JoinHouseholdCard'

const meta = {
  title: 'Feature/JoinHouseholdCard',
  component: JoinHouseholdCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The card on `/invite/[code]`. One status per case: a valid invite signed in or signed out (HON-1131), an invalid one, and three states for a visitor who already has a household (HON-1133): leave and join, cannot leave, and the plain already-member card.',
      },
    },
  },
  args: {
    status: 'valid',
    householdName: 'Kõrvid',
    memberName: 'Mari',
    code: 'ABC123',
  },
} satisfies Meta<typeof JoinHouseholdCard>

export default meta
type Story = StoryObj<typeof meta>

export const Valid: Story = {}

export const ValidHouseholdOnly: Story = {
  args: { memberName: null },
}

export const SignedOut: Story = {
  args: { status: 'signed_out' },
}

export const Invalid: Story = {
  args: { status: 'invalid' },
}

export const AlreadyMember: Story = {
  args: { status: 'already_member', householdName: 'Mari kodu', memberName: null },
  parameters: {
    docs: {
      description: {
        story:
          'No move on offer: the invite is into the household the visitor is already in, or could not be read.',
      },
    },
  },
}

export const LeaveAndJoinSoleOwner: Story = {
  args: {
    status: 'leave_and_join',
    currentHousehold: { name: 'Mari kodu', deletesHousehold: true, otherAccountCount: 0 },
  },
  parameters: {
    docs: {
      description: {
        story:
          'The partner who signed up first: they own a household with no other account, so leaving deletes it. The play function opens the confirm, checks the focus trap, and closes it with Escape.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Leave and join' }))
    const dialog = await body.findByRole('alertdialog')
    // The dialog fades in, so wait for it to be visible.
    await waitFor(() => expect(within(dialog).getByText(/This cannot be undone/)).toBeVisible())
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    for (let i = 0; i < 4; i++) {
      await userEvent.keyboard('{Tab}')
      await expect(dialog.contains(document.activeElement)).toBe(true)
    }

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument())
  },
}

export const LeaveAndJoinMember: Story = {
  args: {
    status: 'leave_and_join',
    currentHousehold: { name: 'Mari kodu', deletesHousehold: false, otherAccountCount: 0 },
  },
  parameters: {
    docs: {
      description: {
        story: 'A member of another household: they leave it, and it keeps its plan.',
      },
    },
  },
}

export const CannotLeave: Story = {
  args: {
    status: 'cannot_leave',
    currentHousehold: { name: 'Mari kodu', deletesHousehold: false, otherAccountCount: 2 },
  },
  parameters: {
    docs: {
      description: {
        story:
          'An owner whose household has other account holders: a link to `/household`, and no join button.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Go to Household' })).toHaveAttribute(
      'href',
      '/household',
    )
  },
}

export const LeaveAndJoinEstonian: Story = {
  ...LeaveAndJoinSoleOwner,
  play: undefined,
  globals: { locale: 'et' },
}

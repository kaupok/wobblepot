import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  createChildMember,
  createManualMemberWithInvite,
  createMember,
  createMemberPreferences,
} from '@/stories/fixtures'
import { MemberRow } from './MemberRow'

const meta = {
  title: 'Feature/Household/MemberRow',
  component: MemberRow,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One member as one unbordered row of `MemberList`: the name (the edit button when `canEdit`), the Owner / Invite pending / No account badges, the portion in short form, and a ⋯ menu with Invite and Remove gated by `canInvite` / `canRemove` (HON-960).',
      },
    },
  },
  // A row is an `li`; outside a list axe flags it (`listitem`).
  decorators: [
    (Story) => (
      <ul className="flex flex-col divide-y">
        <Story />
      </ul>
    ),
  ],
  args: {
    canEdit: true,
    canRemove: true,
    canInvite: false,
    onEdit: fn(),
    onRemove: fn(),
    onInvite: fn(),
    onInviteUpdated: fn(),
  },
} satisfies Meta<typeof MemberRow>

export default meta
type Story = StoryObj<typeof meta>

// The visual variants, plus `ChildMember`'s play function for the menu wiring;
// focus return after the dialogs is asserted in `MemberRow.test.tsx` and
// `MemberList.test.tsx`.

export const Owner: Story = {
  args: {
    member: createMember(),
    canRemove: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Owner row — "Owner" badge, no ⋯ menu (cannot self-remove); the empty menu slot keeps the portion aligned.',
      },
    },
  },
}

export const AdultMember: Story = {
  args: {
    member: createMember({
      id: 'member-2',
      role: 'member',
      name: 'Sky Doe',
      user: { id: 'user-2', name: 'Sky Doe', email: 'sky@example.com', image: null },
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Linked adult member — no badges; the name opens edit, the ⋯ menu offers Remove.',
      },
    },
  },
}

export const ChildMember: Story = {
  args: {
    member: createChildMember(),
    canInvite: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Child member without an account — "No account" badge, "Small 0.75×", ⋯ menu with Invite and Remove.',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'kiddo' }))
    await expect(args.onEdit).toHaveBeenCalledOnce()

    await userEvent.click(canvas.getByRole('button', { name: 'More actions: kiddo' }))
    const menu = await within(document.body).findByRole('menu')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Invite to join' }))
    await expect(args.onInvite).toHaveBeenCalledOnce()
  },
}

export const WithInvitePending: Story = {
  args: {
    member: createManualMemberWithInvite(),
    canInvite: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Member without an account and with an active invite — "Invite pending" replaces "No account"; Invite stays in the menu so the owner can revisit the link.',
      },
    },
  },
}

export const ManualNoInvite: Story = {
  args: {
    member: createChildMember({
      id: 'member-no-invite',
      name: 'Jess',
      preferences: createMemberPreferences({ portionMultiplier: 1.5 }),
    }),
    canInvite: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Member without an account, no invite yet — "No account" badge, "Large 1.5×".',
      },
    },
  },
}

export const WithPreferences: Story = {
  args: {
    member: createMember({
      id: 'member-prefs',
      role: 'member',
      name: 'Mom',
      user: { id: 'user-mom', name: 'Mom Doe', email: 'mom@example.com', image: null },
      preferences: createMemberPreferences({
        displayName: 'Mom',
        portionMultiplier: 0.85,
        allergens: ['gluten', 'nuts'],
        dietaryType: 'pescatarian',
      }),
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Custom-portion member — "Custom 0.85×".',
      },
    },
  },
}

export const ReadOnly: Story = {
  args: {
    member: createMember(),
    canEdit: false,
    canRemove: false,
    canInvite: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Non-owner viewing another member — the name is plain text and there is no menu.',
      },
    },
  },
}

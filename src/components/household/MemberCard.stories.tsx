import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import {
  createChildMember,
  createManualMemberWithInvite,
  createMember,
  createMemberPreferences,
} from '@/stories/fixtures'
import { MemberCard } from './MemberCard'

const meta = {
  title: 'Feature/Household/MemberCard',
  component: MemberCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Single-member row with avatar, name, role/invite badges, and edit/invite/remove actions gated by the can* props. Used inside `MemberList`.',
      },
    },
  },
  args: {
    canEdit: true,
    canRemove: true,
    canInvite: false,
    onEdit: fn(),
    onRemove: fn(),
    onInvite: fn(),
    onInviteUpdated: fn(),
  },
} satisfies Meta<typeof MemberCard>

export default meta
type Story = StoryObj<typeof meta>

// WHY: MemberCard renders a fixed layout based on its props — no async work,
// no state worth play-testing here. The actions it exposes (edit/invite/remove)
// are tested at the integration level in `MemberList` where the click flows
// matter. This file covers the visual variants.

export const Owner: Story = {
  args: {
    member: createMember(),
    canRemove: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Owner row — crown avatar, "Owner" badge, no remove button (cannot self-remove).',
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
        story: 'Linked adult member — generic user avatar, no badges, edit + remove available.',
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
          'Manual child member — "Manual" badge, small portion label, invite button visible (no linked account yet).',
      },
    },
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
          'Manual member with an active invite — "Invite pending" badge replaces "Manual"; invite icon stays so the owner can revisit/regenerate the link.',
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
        story: 'Manual member, no invite created yet — "Manual" badge, large-portion label.',
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
        story: 'Custom-portion member with preferences set — verifies the "Custom portion" label.',
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
        story:
          'Non-owner viewing another member — no actions shown. Pure display variant for the read-only context.',
      },
    },
  },
}

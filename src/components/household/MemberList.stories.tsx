import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  emptyMembersHandlers,
  errorMembersHandlers,
  loadingMembersHandlers,
} from '@/stories/msw-handlers'
import { MemberList } from './MemberList'

const meta = {
  title: 'Feature/Household/MemberList',
  component: MemberList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Owner-facing member roster. Fetches `/api/households/me/members` on mount, renders `MemberCard` for each entry, and wires up the add/edit/invite dialogs. Per-story MSW handlers below force loading / empty / error / populated states deterministically.',
      },
    },
  },
  args: {
    isOwner: true,
    currentMemberId: 'member-owner',
  },
} satisfies Meta<typeof MemberList>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  parameters: {
    msw: { handlers: emptyMembersHandlers },
    docs: {
      description: {
        story:
          'Owner with no members yet — empty-state hint shown, but the "Add member" button still renders.',
      },
    },
  },
}

export const SingleMember: Story = {
  args: { isOwner: false, currentMemberId: 'member-2' },
  parameters: {
    docs: {
      description: {
        story:
          'Non-owner viewing the roster — no "Add member" button, no remove buttons, footnote about owner-only edits visible.',
      },
    },
  },
}

export const MultipleMembers: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Owner viewing the full default roster (owner + adult + child + pending-invite). Exercises every `MemberCard` badge variant in one render.',
      },
    },
  },
}

export const Loading: Story = {
  parameters: {
    msw: { handlers: loadingMembersHandlers },
    docs: {
      description: {
        story: 'Members request never resolves — verifies the skeleton-card placeholder.',
      },
    },
  },
}

export const Error: Story = {
  parameters: {
    msw: { handlers: errorMembersHandlers },
    docs: {
      description: {
        story: 'Members request returns 500 — destructive-toned error message renders inline.',
      },
    },
  },
}

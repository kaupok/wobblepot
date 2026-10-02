import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
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
          'Owner-facing member roster. Fetches `/api/households/me/members` on mount, renders a `MemberRow` per entry in an unbordered `divide-y` list, and wires up the add/edit/invite dialogs. Per-story MSW handlers below force loading / empty / error / populated states deterministically.',
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
          'Non-owner viewing the roster — no "Add member" button and no ⋯ menus; only their own name opens the edit dialog. The owner-only notice is the page\'s, under its title.',
      },
    },
  },
}

export const MultipleMembers: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Owner viewing the full default roster (owner + adult + child + pending-invite). Exercises every `MemberRow` badge variant in one render.',
      },
    },
  },
}

export const Loading: Story = {
  parameters: {
    msw: { handlers: loadingMembersHandlers },
    docs: {
      description: {
        story: 'Members request never resolves — two row-height skeleton lines.',
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

export const Desktop: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'Desktop width. The list fills the width (docs/DESIGN.md → Lists fill, forms stay narrow) and "Add member" sits label-sized at the right end of the title row (HON-960).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = await canvas.findByRole('list')
    const title = canvas.getByRole('heading', { name: 'Members', level: 2 })
    const button = canvas.getByRole('button', { name: 'Add member' })
    const row = title.parentElement!.getBoundingClientRect()
    await expect(list.getBoundingClientRect().width).toBe(row.width)
    await expect(button.getBoundingClientRect().right).toBe(row.right)
    await expect(button.getBoundingClientRect().width).toBeLessThan(row.width / 2)
  },
}

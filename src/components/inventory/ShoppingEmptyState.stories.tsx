import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { ShoppingEmptyState } from './ShoppingEmptyState'

const meta = {
  title: 'Feature/Shopping/ShoppingEmptyState',
  component: ShoppingEmptyState,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What `/shopping` renders instead of `ShoppingSection` when the shopping list failed to load: a heading, one muted line and one primary button, at the top of the column on the page background. It is the only state with no header and no note sheet. An empty list is not this component: it keeps the sheet and its Add field, with a muted line under the field (`ShoppingSection` → `NoPlan`, `NothingNeeded`, `AllPurchased`; HON-1354).',
      },
    },
  },
} satisfies Meta<typeof ShoppingEmptyState>

export default meta
type Story = StoryObj<typeof meta>

export const ErrorState: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The shopping-list request failed. A CTA rather than a retry, because reloading the route is the retry, and no header, since the window is not what failed. The CTA is labelled "Go to dashboard" and its `href` is `/`, which is the dashboard (HON-623). The heading is Title level (`variant="h4"`) per the docs/DESIGN.md type scale.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/')
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument()
  },
}

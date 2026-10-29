import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { EntryChangesList } from './EntryChangesList'

const meta = {
  title: 'Meal plan/EntryChangesList',
  component: EntryChangesList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The entry’s ingredient changes above the preparation steps (HON-1243), so the cook sees them while cooking. A stale change does nothing and is left out.',
      },
    },
  },
  args: {
    changes: [
      {
        id: 'c1',
        original: { id: 'cream', name: 'Cream' },
        replacement: { id: 'yoghurt', name: 'Yoghurt' },
        quantityPerServing: 60,
        stale: false,
      },
      {
        id: 'c2',
        original: { id: 'mushroom', name: 'Mushrooms' },
        replacement: null,
        quantityPerServing: null,
        stale: false,
      },
      {
        id: 'c3',
        original: null,
        replacement: { id: 'chili', name: 'Chili' },
        quantityPerServing: 2,
        stale: false,
      },
      {
        id: 'c4',
        original: { id: 'bacon', name: 'Bacon' },
        replacement: null,
        quantityPerServing: null,
        stale: true,
      },
    ],
  },
} satisfies Meta<typeof EntryChangesList>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Changes for this meal' })).toBeVisible()
    await expect(canvas.getByText('Replaced: Cream → Yoghurt')).toBeVisible()
    await expect(canvas.getByText('Left out: Mushrooms')).toBeVisible()
    await expect(canvas.getByText('Added: Chili')).toBeVisible()
    await expect(canvas.queryByText(/Bacon/)).toBeNull()
  },
}

/** Only stale changes, or none: nothing renders. */
export const OnlyStale: Story = {
  args: {
    changes: [
      {
        id: 'c4',
        original: { id: 'bacon', name: 'Bacon' },
        replacement: null,
        quantityPerServing: null,
        stale: true,
      },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toBeEmptyDOMElement()
  },
}

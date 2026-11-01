import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { timelineTodayDate } from '@/stories/fixtures'

import { type AtHomeItem, AtHomeList } from './AtHomeList'

function row(name: string, overrides: Partial<AtHomeItem> = {}): AtHomeItem {
  const key = name.toLowerCase().replace(/ /g, '-')
  return {
    ingredientId: `ing-${key}`,
    name,
    displayQuantity: '200g',
    neededByDate: timelineTodayDate,
    urgency: 'today',
    pantryRows: [{ id: `pantry-${key}`, quantity: null }],
    isStaple: false,
    ...overrides,
  }
}

const atHomeItems: AtHomeItem[] = [
  row('Basmati rice', { displayQuantity: '1.5kg' }),
  row('Sea salt', {
    displayQuantity: '8g',
    isStaple: true,
    pantryRows: [{ id: 'pantry-sea-salt', quantity: 5 }],
  }),
  row('Chicken thigh', {
    displayQuantity: '200g',
    pantryRows: [{ id: 'pantry-chicken-thigh', quantity: 200 }],
  }),
  row('Basil', {
    displayQuantity: '20g',
    urgency: 'tomorrow',
    pantryRows: [{ id: 'pantry-fresh-basil', quantity: null }],
  }),
]

const meta = {
  title: 'Feature/Timeline/AtHomeList',
  component: AtHomeList,
  tags: ['autodocs'],
  args: { items: atHomeItems },
  parameters: { layout: 'padded' },
  // The sidebar's real width, as in the UrgentShopping stories.
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AtHomeList>

export default meta
type Story = StoryObj<typeof meta>

/** Today, then Tomorrow; each row with its amount and the pantry switch, on. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('list', { name: 'Today' })).toBeInTheDocument()
    await expect(canvas.getByRole('list', { name: 'Tomorrow' })).toBeInTheDocument()
    await expect(canvas.getAllByRole('switch')).toHaveLength(4)
    for (const control of canvas.getAllByRole('switch')) await expect(control).toBeChecked()
    await expect(canvas.getByRole('img', { name: 'Staple' })).toBeInTheDocument()
  },
}

/** A long name truncates, and the amount and switch stay in the column. */
export const LongName: Story = {
  args: {
    items: [row('Extra virgin cold-pressed olive oil from Crete', { displayQuantity: '30ml' })],
  },
  play: async ({ canvasElement }) => {
    const control = within(canvasElement).getByRole('switch')
    const column = canvasElement.querySelector('.w-80')!.getBoundingClientRect()
    await expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(column.right)
  },
}

export const Empty: Story = {
  args: { items: [] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Nothing from the pantry for today or tomorrow'),
    ).toBeInTheDocument()
  },
}

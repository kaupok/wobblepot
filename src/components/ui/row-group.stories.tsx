import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Body } from '@/components/ui/typography'
import { RowGroup } from './row-group'

const meta = {
  title: 'UI/RowGroup',
  component: RowGroup,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The box around a group of list rows on `/shopping` and `/pantry`: one border, one radius, a divider between rows. Rows inside carry only their padding and backgrounds. `ShoppingItem`, `CustomShoppingItem` and `PantryItemRow` are the rows it holds; their stories render inside it.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RowGroup>

export default meta
type Story = StoryObj<typeof meta>

function Row({ children }: { children: string }) {
  return (
    <div className="min-h-touch hover:bg-muted/50 flex items-center p-3">
      <Body>{children}</Body>
    </div>
  )
}

export const Default: Story = {
  render: () => (
    <RowGroup>
      <Row>Chicken breast</Row>
      <Row>Rice</Row>
      <Row>Broccoli</Row>
    </RowGroup>
  ),
}

export const SingleRow: Story = {
  render: () => (
    <RowGroup>
      <Row>Chicken breast</Row>
    </RowGroup>
  ),
  parameters: {
    docs: {
      description: {
        story: 'A group of one draws no divider: the box alone is the card.',
      },
    },
  },
}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect } from 'storybook/test'
import { Body, Heading } from '@/components/ui/typography'
import { Card, CardContent } from './card'
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
          'The box around a group of list rows on `/shopping` and `/pantry`: one border, one radius, a divider between rows. Rows inside carry only their padding and backgrounds. `ShoppingItem`, `CustomShoppingItem` and `PantryItemRow` are the rows it holds; their stories render inside it. `variant="ruled"` is the same rows on the shopping list\'s note sheet: no box, because the sheet is already the container (HON-1016), and no dividers, because the group headings and the spacing already separate the rows (HON-1017). The rows are pulled out by their own padding so their content lines up with the heading above.',
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
    <div className="min-h-touch hover:bg-accent/50 flex items-center p-3">
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

/** The rows on the shopping list's note sheet: no box, no dividers (HON-1016, HON-1017). */
export const Ruled: Story = {
  render: () => (
    <Card data-surface="note">
      <CardContent>
        <div className="flex flex-col gap-2">
          <Heading variant="caption" as="h3">
            Protein
          </Heading>
          <RowGroup variant="ruled" data-testid="ruled">
            <Row>Chicken breast</Row>
            <Row>Salmon</Row>
            <Row>Tofu</Row>
          </RowGroup>
        </div>
      </CardContent>
    </Card>
  ),
  play: async ({ canvasElement }) => {
    const group = canvasElement.querySelector<HTMLElement>('[data-testid="ruled"]')!
    const style = getComputedStyle(group)
    // No box of its own: the sheet contains, the headings and spacing separate.
    await expect(style.borderTopWidth).toBe('0px')
    await expect(style.borderLeftWidth).toBe('0px')
    // No rule between rows either (HON-1017).
    for (const row of group.children) {
      await expect(getComputedStyle(row).borderTopWidth).toBe('0px')
      await expect(getComputedStyle(row).borderBottomWidth).toBe('0px')
    }
    // A row's content (inside its `p-3`) starts on the heading's left edge.
    const heading = canvasElement.querySelector('h3')!
    const firstText = group.querySelector('p')!
    await expect(
      Math.round(firstText.getBoundingClientRect().left - heading.getBoundingClientRect().left),
    ).toBe(0)
  },
}

/** Both variants: the pantry's bordered group beside the list's ruled one. */
export const BothVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <RowGroup data-testid="default">
        <Row>Olive oil</Row>
        <Row>Rice</Row>
      </RowGroup>
      <Card data-surface="note">
        <CardContent>
          <RowGroup variant="ruled" data-testid="ruled">
            <Row>Chicken breast</Row>
            <Row>Broccoli</Row>
          </RowGroup>
        </CardContent>
      </Card>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLElement>('[data-testid="default"]')!
    const ruled = canvasElement.querySelector<HTMLElement>('[data-testid="ruled"]')!
    await expect(getComputedStyle(box).borderTopWidth).toBe('1px')
    await expect(getComputedStyle(ruled).borderTopWidth).toBe('0px')
    // The pantry's box keeps its divider between rows; the sheet's ruled
    // group draws none (HON-1017).
    await expect(getComputedStyle(box.children[0]!).borderBottomWidth).toBe('1px')
    await expect(getComputedStyle(ruled.children[0]!).borderBottomWidth).toBe('0px')
  },
}

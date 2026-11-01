import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

const meta = {
  title: 'UI/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  render: () => (
    <Tabs defaultValue="buy">
      <TabsList aria-label="Shopping">
        <TabsTrigger value="buy">To buy</TabsTrigger>
        <TabsTrigger value="home">At home</TabsTrigger>
      </TabsList>
      <TabsContent value="buy">Milk, eggs</TabsContent>
      <TabsContent value="home">Salt, basil</TabsContent>
    </Tabs>
  ),
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** The arrow key moves to the next tab and shows its panel. */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'To buy' }))
    await userEvent.keyboard('{ArrowRight}')
    const atHome = canvas.getByRole('tab', { name: 'At home' })
    await expect(atHome).toHaveFocus()
    await expect(atHome).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Salt, basil')
  },
}

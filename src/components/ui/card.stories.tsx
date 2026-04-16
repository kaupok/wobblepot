import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Button } from './button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card'

const meta = {
  title: 'UI/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Weekly meal plan</CardTitle>
        <CardDescription>7 dinners planned for Mon–Sun.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">
          Lemon-garlic chicken, sheet-pan salmon, mushroom risotto, and four more.
        </p>
      </CardContent>
      <CardFooter>
        <Button>View plan</Button>
      </CardFooter>
    </Card>
  ),
}

export const WithAction: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Pantry</CardTitle>
        <CardDescription>12 staples, 4 expiring soon.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm">
            Edit
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm">Olive oil, garlic, salt, flour, rice, pasta…</p>
      </CardContent>
    </Card>
  ),
}

export const HeaderOnly: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Quick stat</CardTitle>
        <CardDescription>No body, no footer.</CardDescription>
      </CardHeader>
    </Card>
  ),
}

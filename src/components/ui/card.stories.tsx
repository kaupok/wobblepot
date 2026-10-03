import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
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

// `size="sm"`: the dense card of a grid of many (a meal-plan day). Only the
// card's own gap and vertical padding tighten; the parts' horizontal padding
// is set by the page, as `MealCard` does.
export const Small: Story = {
  render: () => (
    <Card size="sm" className="w-64">
      <CardHeader className="px-3">
        <CardTitle>Mushroom risotto</CardTitle>
      </CardHeader>
      <CardContent className="px-3">
        <p className="text-muted-foreground text-sm">Dinner · 45 min</p>
      </CardContent>
      <CardFooter className="px-3">
        <Button variant="outline" size="sm" className="w-full">
          Swap
        </Button>
      </CardFooter>
    </Card>
  ),
}

// `interactive`: a pointer click anywhere opens the card (the planner card,
// HON-1010). The card stays a plain `div`; its keyboard target is the control
// marked `data-slot="card-target"`, and the card draws that control's focus
// ring around itself.
export const Interactive: Story = {
  render: () => (
    <Card size="sm" interactive className="w-64">
      <CardHeader className="px-3">
        <CardTitle>
          <button
            type="button"
            data-slot="card-target"
            className="cursor-pointer outline-none group-hover/card:underline"
          >
            Mushroom risotto
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3">
        <p className="text-muted-foreground text-sm">Dinner · 45 min</p>
      </CardContent>
    </Card>
  ),
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    const target = within(canvasElement).getByRole('button', { name: 'Mushroom risotto' })
    await expect(getComputedStyle(card).cursor).toBe('pointer')
    await expect(getComputedStyle(card).boxShadow).toBe('none')

    target.focus()
    await expect(target.matches(':focus-visible')).toBe(true)
    await expect(getComputedStyle(card).boxShadow).not.toBe('none')
    await expect(getComputedStyle(target).outlineStyle).toBe('none')
  },
}

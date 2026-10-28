import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { CheckCircle2, MoreHorizontal, RefreshCw, Share2, Trash2 } from 'lucide-react'
import { expect, within } from 'storybook/test'
import { Button } from './button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu'

const meta = {
  title: 'UI/DropdownMenu',
  component: DropdownMenu,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Portal-based menu. Toggle the theme toolbar to verify content renders correctly in dark mode.',
      },
    },
  },
} satisfies Meta<typeof DropdownMenu>

export default meta
type Story = StoryObj<typeof meta>

// WHY: Radix sets aria-hidden on sibling content when the portal opens; axe flags
// this as aria-hidden-focus because the underlying trigger is still a focusable
// <button>. In real usage Radix's focus trap prevents reaching it. Applies to all
// Open stories below that render with `defaultOpen: true`.
const openDropdownA11y = {
  config: { rules: [{ id: 'aria-hidden-focus', enabled: false }] },
}

/** The default item: 16px text in a row under 44px. */
export const Open: Story = {
  args: { defaultOpen: true },
  parameters: { a11y: openDropdownA11y },
  play: async () => {
    const item = await within(document.body).findByRole('menuitem', { name: 'Regenerate' })
    // `offsetHeight`, not the rect: the menu scales in from 95%.
    await expect(item.offsetHeight).toBeLessThan(44)
    await expect(getComputedStyle(item).fontSize).toBe('16px')
  },
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Meal actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuItem>
          <CheckCircle2 />
          Mark completed
          <DropdownMenuShortcut>⌘⏎</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <RefreshCw />
          Regenerate
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Share2 />
          Share
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>More options</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuItem>Move to next week</DropdownMenuItem>
            <DropdownMenuItem>Pin to top</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

/** `size="lg"`: 16px text in a row of 44px or more, for the cook view's ⋯ menus (HON-1359). */
export const LargeItems: Story = {
  args: { defaultOpen: true },
  parameters: { a11y: openDropdownA11y },
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Step actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem size="lg">Replace</DropdownMenuItem>
        <DropdownMenuItem size="lg">Leave out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async () => {
    const menu = await within(document.body).findByRole('menu')
    for (const item of within(menu).getAllByRole('menuitem')) {
      await expect(item.offsetHeight).toBeGreaterThanOrEqual(44)
      await expect(getComputedStyle(item).fontSize).toBe('16px')
    }
  },
}

export const WithCheckboxItems: Story = {
  args: { defaultOpen: true },
  parameters: { a11y: openDropdownA11y },
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Visible columns</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem defaultChecked>Meal name</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem defaultChecked>Time</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem>Calories</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem>Protein</DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

export const WithRadioItems: Story = {
  args: { defaultOpen: true },
  parameters: { a11y: openDropdownA11y },
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Sort by</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Sort meals</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup defaultValue="name">
          <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="time">Cook time</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="recent">Recently added</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

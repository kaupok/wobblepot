import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { Skeleton } from './skeleton'

const meta = {
  title: 'UI/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: {
    shape: { control: 'select', options: ['default', 'card', 'circle', 'checkbox', 'flush'] },
  },
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { className: 'h-4 w-48' },
}

export const Card: Story = {
  args: { shape: 'card', className: 'h-16 w-64' },
}

export const Circle: Story = {
  args: { shape: 'circle', className: 'size-12' },
}

export const Checkbox: Story = {
  args: { shape: 'checkbox', className: 'size-5' },
}

export const Flush: Story = {
  render: () => (
    <div className="w-64 overflow-hidden rounded-xl border">
      <Skeleton shape="flush" className="aspect-3/2 w-full" />
      <div className="p-3">
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  ),
}

// Every shape side by side. The play function pins each to its radius class, so
// a variant that drifts from what it mirrors fails here rather than on a route.
export const AllShapes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Skeleton data-testid="default" className="h-4 w-24" />
      <Skeleton data-testid="card" shape="card" className="h-16 w-24" />
      <Skeleton data-testid="circle" shape="circle" className="size-10" />
      <Skeleton data-testid="checkbox" shape="checkbox" className="size-5" />
      <Skeleton data-testid="flush" shape="flush" className="h-16 w-24" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('default')).toHaveClass('rounded-md')
    await expect(canvas.getByTestId('card')).toHaveClass('rounded-lg')
    await expect(canvas.getByTestId('circle')).toHaveClass('rounded-full')
    await expect(canvas.getByTestId('checkbox')).toHaveClass('rounded-sm')
    await expect(canvas.getByTestId('flush')).toHaveClass('rounded-none')
  },
}

export const CardShape: Story = {
  render: () => (
    <div className="w-64 space-y-3 rounded-lg border p-4">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <div className="flex items-center gap-2 pt-2">
        <Skeleton shape="circle" className="size-8" />
        <div className="flex-1 space-y-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    </div>
  ),
}

export const ListShape: Story = {
  render: () => (
    <div className="w-72 space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-md border p-3">
          <Skeleton className="size-10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  ),
}

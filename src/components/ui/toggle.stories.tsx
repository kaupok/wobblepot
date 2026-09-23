import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Bold, ThumbsDown, ThumbsUp } from 'lucide-react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Toggle } from './toggle'

const meta = {
  title: 'UI/Toggle',
  component: Toggle,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['default', 'outline'] },
    tone: { control: 'select', options: ['default', 'success', 'destructive'] },
    shape: { control: 'select', options: ['default', 'circle'] },
    size: { control: 'select', options: ['default', 'sm', 'lg'] },
    pressed: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  args: {
    'aria-label': 'Bold',
    children: <Bold />,
    onPressedChange: fn(),
  },
} satisfies Meta<typeof Toggle>

export default meta
type Story = StoryObj<typeof meta>

/** Uncontrolled: a click flips `aria-pressed` and reports the next state. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const toggle = within(canvasElement).getByRole('button', { name: 'Bold' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(args.onPressedChange).toHaveBeenCalledWith(true)
  },
}

export const Pressed: Story = {
  args: { pressed: true },
}

export const Outline: Story = {
  args: { variant: 'outline' },
}

export const WithText: Story = {
  args: {
    'aria-label': undefined,
    children: (
      <>
        <Bold />
        Bold
      </>
    ),
  },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Toggle {...args} size="sm" aria-label="Small" />
      <Toggle {...args} size="default" aria-label="Default" />
      <Toggle {...args} size="lg" aria-label="Large" />
    </div>
  ),
}

export const Circle: Story = {
  args: { shape: 'circle', size: 'sm' },
}

/**
 * Every tone, at rest and pressed. The pressed state carries the tone's
 * meaning — the thumbs pair in `MealRatingInline` is the reference use — so
 * the a11y run measures each pressed tint's contrast in light and dark.
 */
export const AllTones: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(['default', 'success', 'destructive'] as const).map((tone) => (
        <div key={tone} className="flex items-center gap-2">
          <Toggle tone={tone} shape="circle" size="sm" aria-label={`${tone} off`}>
            {tone === 'destructive' ? <ThumbsDown /> : <ThumbsUp />}
          </Toggle>
          <Toggle tone={tone} shape="circle" size="sm" pressed aria-label={`${tone} on`}>
            {tone === 'destructive' ? <ThumbsDown /> : <ThumbsUp />}
          </Toggle>
          <Toggle tone={tone} pressed aria-label={`${tone} square`}>
            {tone === 'destructive' ? <ThumbsDown /> : <ThumbsUp />}
          </Toggle>
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const tone of ['default', 'success', 'destructive']) {
      await expect(canvas.getByRole('button', { name: `${tone} off` })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
      await expect(canvas.getByRole('button', { name: `${tone} on` })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    }
  },
}

/** `AllTones` in the dark theme, so the a11y run measures the pressed tints there too. */
export const AllTonesDark: Story = {
  ...AllTones,
  globals: {
    theme: 'dark',
  },
}

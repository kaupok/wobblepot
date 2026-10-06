import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { Callout } from './callout'

const meta = {
  title: 'UI/Callout',
  component: Callout,
  tags: ['autodocs'],
  argTypes: {
    tone: {
      control: 'select',
      options: ['info', 'warning', 'success'],
    },
  },
  args: {
    children: "We're in private beta. You'll need an invite code to sign up.",
  },
} satisfies Meta<typeof Callout>

export default meta
type Story = StoryObj<typeof meta>

export const InfoTone: Story = {
  args: { tone: 'info' },
}

export const WarningTone: Story = {
  args: { tone: 'warning', children: 'Some ingredients could not be matched. Check them below.' },
}

export const SuccessTone: Story = {
  args: { tone: 'success', children: 'Your household is set up. Plan your first week.' },
}

/**
 * The private-beta notice as `/sign-up` renders it: `role="note"` with a
 * translated name, and an inline link. Long enough to wrap at the default
 * mobile viewport, so the icon has to stay on the first line.
 */
export const WrappingWithLink: Story = {
  args: {
    tone: 'info',
    role: 'note',
    'aria-label': 'Private beta notice',
    children: (
      <>
        Private beta — sign-up is by invite code only. Don&apos;t have one?{' '}
        <a href="/request-invite" className="underline">
          Ask for an invite
        </a>
        .
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const notice = canvas.getByRole('note', { name: 'Private beta notice' })
    await expect(within(notice).getByRole('link', { name: 'Ask for an invite' })).toBeVisible()

    const icon = notice.querySelector('svg')
    await expect(icon).toHaveAttribute('aria-hidden', 'true')

    // The text wraps beside the icon, and the icon stays on its first line.
    const text = notice.querySelector('p')
    expect(text).not.toBeNull()
    const lineHeight = parseFloat(getComputedStyle(text!).lineHeight)
    await expect(text!.getBoundingClientRect().height).toBeGreaterThan(lineHeight)
    await expect(icon!.getBoundingClientRect().top).toBeLessThan(
      text!.getBoundingClientRect().top + lineHeight,
    )
    await expect(notice.scrollWidth).toBeLessThanOrEqual(notice.clientWidth)
  },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Callout tone="info">Info: a short notice the user should read before acting.</Callout>
      <Callout tone="warning">Warning: something needs checking before you go on.</Callout>
      <Callout tone="success">Success: the thing you did worked.</Callout>
    </div>
  ),
}

/** The same three tones in the dark theme, so the a11y gate measures both. */
export const AllVariantsDark: Story = {
  ...AllVariants,
  globals: { theme: 'dark' },
}

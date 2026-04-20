import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
  pressEscape,
} from '@/stories/a11y-helpers'
import { ConsentContext, type AnalyticsConsent } from '@/components/ConsentProvider'
import { CookieSettingsTrigger } from '@/components/CookieSettingsTrigger'

interface TriggerStoryArgs {
  granted: boolean | null
  grant: () => void
  withdraw: () => void
}

const meta = {
  title: 'Feature/CookieSettingsTrigger',
  component: CookieSettingsTrigger,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Footer entry point that lets users re-open their cookie choice after the first-visit banner has been dismissed. Opens a Radix `Dialog`.',
      },
    },
  },
  args: {
    granted: true,
    grant: fn(),
    withdraw: fn(),
  },
  decorators: [
    (Story, context) => {
      const { granted, grant, withdraw } = context.args as unknown as TriggerStoryArgs
      const value: AnalyticsConsent = { granted, grant, withdraw }
      return (
        <ConsentContext.Provider value={value}>
          <Story />
        </ConsentContext.Provider>
      )
    },
  ],
} satisfies Meta<typeof CookieSettingsTrigger>

export default meta
type Story = StoryObj<TriggerStoryArgs>

export const AnalyticsOn: Story = {}

export const EssentialOnly: Story = {
  args: { granted: false },
}

export const Undecided: Story = {
  args: { granted: null },
}

export const OpensAndTrapsFocus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /cookie settings/i }))
    await assertFocusInDialog()
    await assertTabStaysInDialog()
    await pressEscape()
    await awaitDialogClosed()
  },
}

export const AcceptAnalyticsClosesDialog: Story = {
  args: { granted: false },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)
    await userEvent.click(canvas.getByRole('button', { name: /cookie settings/i }))
    await userEvent.click(await body.findByRole('button', { name: /accept analytics/i }))
    expect(args.grant).toHaveBeenCalledTimes(1)
    await awaitDialogClosed()
  },
}

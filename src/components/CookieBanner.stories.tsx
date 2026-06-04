import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ConsentContext, type AnalyticsConsent } from '@/components/ConsentProvider'
import { CookieBanner } from '@/components/CookieBanner'

interface CookieBannerStoryArgs {
  granted: boolean | null
  grant: () => void
  withdraw: () => void
}

const meta = {
  title: 'Feature/CookieBanner',
  component: CookieBanner,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'First-visit cookie-consent banner. Rendered by `ConsentProvider` when the user has not yet decided. Satisfies the ePrivacy Directive opt-in requirement before PostHog initializes (see HON-474).',
      },
    },
  },
  args: {
    granted: null,
    grant: fn(),
    withdraw: fn(),
  },
  decorators: [
    (Story, context) => {
      const { granted, grant, withdraw } = context.args as unknown as CookieBannerStoryArgs
      const value: AnalyticsConsent = { granted, grant, withdraw }
      return (
        <ConsentContext.Provider value={value}>
          <div className="bg-background relative h-[500px] w-full">
            <Story />
          </div>
        </ConsentContext.Provider>
      )
    },
  ],
} satisfies Meta<typeof CookieBanner>

export default meta
type Story = StoryObj<CookieBannerStoryArgs>

export const Undecided: Story = {
  play: async () => {
    const body = within(document.body)
    const region = await body.findByRole('region', { name: /cookie consent/i })
    expect(region).toBeInTheDocument()
    // Informed consent: the banner links the policy it asks consent for (HON-457)
    const policyLink = await body.findByRole('link', { name: /privacy policy/i })
    expect(policyLink).toHaveAttribute('href', '/privacy#cookies')
  },
}

export const AcceptAll: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: 'Accept all' }))
    expect(args.grant).toHaveBeenCalledTimes(1)
  },
}

export const EssentialOnly: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: 'Essential only' }))
    expect(args.withdraw).toHaveBeenCalledTimes(1)
  },
}

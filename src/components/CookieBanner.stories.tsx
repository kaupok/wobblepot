import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ConsentContext, type AnalyticsConsent } from '@/components/ConsentProvider'
import { CookieBanner } from '@/components/CookieBanner'

interface CookieBannerStoryArgs {
  hasTabBar: boolean
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
  render: ({ hasTabBar }) => <CookieBanner hasTabBar={hasTabBar} />,
  args: {
    hasTabBar: false,
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
} satisfies Meta<CookieBannerStoryArgs>

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

// The banner is `fixed`, so these measure it against the story's viewport,
// which `.storybook/vitest.setup.ts` syncs to the Vitest page (390×844 here).
async function assertPhoneLayout(expectedBottomInset: number, maxHeight: number) {
  const body = within(document.body)
  const region = await body.findByRole('region', { name: /cookie consent|küpsiste nõusolek/i })
  // Geist loads async; measuring before it swaps in reads the fallback font's
  // line breaks, and the height then varies from run to run.
  await document.fonts.ready
  const [essentialBox, acceptBox] = within(region)
    .getAllByRole('button')
    .map((button) => button.getBoundingClientRect())
  if (!essentialBox || !acceptBox) throw new Error('Expected two consent buttons')

  // One row below `sm`, each half the row at the full 44px control height.
  expect(essentialBox.top).toBe(acceptBox.top)
  expect(essentialBox.height).toBe(44)
  expect(acceptBox.height).toBe(44)

  const regionBox = region.getBoundingClientRect()
  expect(window.innerHeight - regionBox.bottom).toBe(expectedBottomInset)
  // It covered the landing page's only button at 328px (HON-845). The copy
  // must clear the limit with a good part of a line to spare: Linux Skia
  // shapes Geist a few px wider than macOS, and the first English draft sat
  // 29px short of a line break there and wrapped once more on CI.
  expect(regionBox.height).toBeLessThanOrEqual(maxHeight)

  // Informed consent: the link survives the shorter copy (HON-457).
  expect(within(region).getByRole('link')).toHaveAttribute('href', '/privacy#cookies')
}

/** Signed out, on onboarding or an invite: no tab bar, so a 16px inset (HON-845). */
export const PhoneWithoutTabBar: Story = {
  args: { hasTabBar: false },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  play: async () => {
    await assertPhoneLayout(16, 240)
  },
}

/** Signed in with a household: the banner sits 80px up, clear of the 64px tab bar. */
export const PhoneWithTabBar: Story = {
  args: { hasTabBar: true },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  play: async () => {
    await assertPhoneLayout(80, 240)
  },
}

/** The longer Estonian labels still fit side by side at 390px. */
export const PhoneEstonian: Story = {
  args: { hasTabBar: false },
  globals: { locale: 'et', viewport: { value: 'mobileIphone', isRotated: false } },
  play: async () => {
    await assertPhoneLayout(16, 264)
    const body = within(document.body)
    for (const name of ['Ainult olulised', 'Nõustu kõigega']) {
      const button = body.getByRole('button', { name })
      // `whitespace-nowrap` keeps the label on one line; this catches it
      // overflowing the half-row instead.
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth)
    }
  },
}

export const Desktop: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'
import { ConsentContext, type AnalyticsConsent } from '@/components/ConsentProvider'
import { Footer } from '@/components/footer'

interface FooterStoryArgs {
  granted: boolean | null
}

const meta = {
  title: 'Feature/Footer',
  component: Footer,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Site footer rendered on every page (authenticated and public). Shows the privacy policy and terms of service links (HON-457), the support email link, and the cookie-settings entry point.',
      },
    },
  },
  args: {
    granted: true,
  },
  decorators: [
    (Story, context) => {
      const { granted } = context.args as unknown as FooterStoryArgs
      const value: AnalyticsConsent = { granted, grant: fn(), withdraw: fn() }
      return (
        <ConsentContext.Provider value={value}>
          <Story />
        </ConsentContext.Provider>
      )
    },
  ],
} satisfies Meta<typeof Footer>

export default meta
type Story = StoryObj<FooterStoryArgs>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = await canvas.findByRole('link', { name: /support@wobblepot\.com/i })
    await expect(link).toHaveAttribute('href', 'mailto:support@wobblepot.com')
    // Legal links (HON-457)
    const privacy = await canvas.findByRole('link', { name: /privacy policy/i })
    await expect(privacy).toHaveAttribute('href', '/privacy')
    const terms = await canvas.findByRole('link', { name: /terms of service/i })
    await expect(terms).toHaveAttribute('href', '/terms')
  },
}

export const EssentialOnly: Story = {
  args: { granted: false },
}

export const Undecided: Story = {
  args: { granted: null },
}

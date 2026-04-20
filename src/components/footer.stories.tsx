import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
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
          'Minimal site footer introduced for the cookie-settings entry point. HON-487 (support email) and HON-457 (privacy/terms links) will extend it.',
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

export const Default: Story = {}

export const EssentialOnly: Story = {
  args: { granted: false },
}

export const Undecided: Story = {
  args: { granted: null },
}

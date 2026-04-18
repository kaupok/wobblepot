import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { createSession } from '@/stories/fixtures'
import { NavigationLeft, NavigationRight } from './navigation'

const authedSession = createSession()

const meta = {
  title: 'Feature/Navigation/Navigation',
  component: NavigationLeft,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Desktop top-nav link groups rendered inside the `Header`. `NavigationLeft` covers daily operational views (Today, Pantry & shopping); `NavigationRight` covers configuration (My recipes, Household). Both render `null` when no session or no household — the desktop nav only exists after onboarding.',
      },
    },
  },
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
} satisfies Meta<typeof NavigationLeft>

export default meta
type Story = StoryObj<typeof meta>

// `NavigationLeft` and `NavigationRight` share the same NavigationProps shape
// and are siblings inside the header. `component: NavigationLeft` is used for
// autodocs; individual stories render whichever variant they care about.

export const LeftWithHousehold: Story = {
  args: { session: authedSession, hasHousehold: true },
  render: (args) => <NavigationLeft {...args} />,
}

export const RightWithHousehold: Story = {
  args: { session: authedSession, hasHousehold: true },
  render: (args) => <NavigationRight {...args} />,
}

export const BothAllVariants: Story = {
  args: { session: authedSession, hasHousehold: true },
  parameters: {
    docs: {
      description: {
        story:
          'Left and right nav side by side, matching the layout of `Header` — left group after the logo, right group before the user menu.',
      },
    },
  },
  render: (args) => (
    <div className="flex items-center justify-between gap-8">
      <NavigationLeft {...args} />
      <NavigationRight {...args} />
    </div>
  ),
}

export const HiddenWhenLoggedOut: Story = {
  args: { session: null, hasHousehold: false },
  parameters: {
    docs: {
      description: {
        story:
          'Renders `null` for both left and right when there is no session (sign-in / sign-up screens).',
      },
    },
  },
  render: (args) => (
    <div className="flex items-center justify-between gap-8">
      <NavigationLeft {...args} />
      <NavigationRight {...args} />
      <span className="text-muted-foreground text-sm">(nav renders nothing)</span>
    </div>
  ),
}

export const HiddenDuringOnboarding: Story = {
  args: { session: authedSession, hasHousehold: false },
  parameters: {
    docs: {
      description: {
        story:
          'Authenticated but no household yet — nav stays hidden through onboarding so the user can focus on the household-setup flow.',
      },
    },
  },
  render: (args) => (
    <div className="flex items-center justify-between gap-8">
      <NavigationLeft {...args} />
      <NavigationRight {...args} />
      <span className="text-muted-foreground text-sm">(nav renders nothing)</span>
    </div>
  ),
}

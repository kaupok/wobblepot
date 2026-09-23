import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { createSession } from '@/stories/fixtures'
import { BottomTabBar } from './bottom-tab-bar'

const authedSession = createSession()

const meta = {
  title: 'Feature/Navigation/BottomTabBar',
  component: BottomTabBar,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Fixed bottom tab bar for mobile: Today, Shopping, Pantry, Recipes. Hidden on `md:` and up. Active tab is derived from the current pathname — root path (`/`) matches exactly; other tabs also match their sub-routes (via the shared `isNavItemActive` helper) so nested routes (e.g. `/recipes/123`) still highlight the correct tab.',
      },
    },
  },
  args: {
    session: authedSession,
    hasHousehold: true,
  },
} satisfies Meta<typeof BottomTabBar>

export default meta
type Story = StoryObj<typeof meta>

export const Today: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/' } },
  },
}

export const Shopping: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/shopping' } },
  },
}

export const Pantry: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/pantry' } },
    docs: {
      description: {
        story:
          'Pantry took the slot Household had (HON-776); Household is in the account sheet. `/pantry` lights only Pantry, never Shopping.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const links = within(canvasElement).getAllByRole('link')
    await expect(links.map((link) => link.textContent)).toEqual([
      'Today',
      'Shopping',
      'Pantry',
      'Recipes',
    ])
    const current = links.filter((link) => link.getAttribute('aria-current') === 'page')
    await expect(current).toHaveLength(1)
    await expect(current[0]).toHaveAccessibleName('Pantry')
  },
}

export const Recipes: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/recipes' } },
  },
}

export const NestedRouteHighlightsParent: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/recipes/meal-123' } },
    docs: {
      description: {
        story:
          'Nested route under `/recipes` — the Recipes tab stays active via `startsWith`. Today (`/`) does not match because root comparison is exact.',
      },
    },
  },
}

export const HiddenWhenLoggedOut: Story = {
  args: { session: null, hasHousehold: false },
  parameters: {
    nextjs: { navigation: { pathname: '/' } },
    docs: {
      description: {
        story:
          'Renders `null` when there is no session — sign-in and sign-up screens get no bottom nav.',
      },
    },
  },
  render: (args) => (
    <div className="p-6">
      <BottomTabBar {...args} />
      <p className="text-muted-foreground text-sm">(bottom nav renders nothing)</p>
    </div>
  ),
}

export const HiddenDuringOnboarding: Story = {
  args: { session: authedSession, hasHousehold: false },
  parameters: {
    nextjs: { navigation: { pathname: '/onboarding' } },
    docs: {
      description: {
        story:
          'Authenticated but no household — bottom nav stays hidden through onboarding so the user focuses on household setup.',
      },
    },
  },
  render: (args) => (
    <div className="p-6">
      <BottomTabBar {...args} />
      <p className="text-muted-foreground text-sm">(bottom nav renders nothing)</p>
    </div>
  ),
}

export const DesktopHidden: Story = {
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  parameters: {
    nextjs: { navigation: { pathname: '/' } },
    docs: {
      description: {
        story:
          'At `md:` and wider the bottom tab bar is hidden via `md:hidden`. The DOM element is still rendered, just visually hidden.',
      },
    },
  },
}

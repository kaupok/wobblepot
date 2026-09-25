import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { NavigationLeft, NavigationRight } from './navigation'

const meta = {
  title: 'Feature/Navigation/Navigation',
  component: NavigationLeft,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Desktop top-nav link groups rendered inside the `Header`. `NavigationLeft` covers daily operational views (Today, Pantry & shopping); `NavigationRight` covers configuration (My recipes, Household). The link for the current route is in the foreground colour (the rest are muted) and carries `aria-current="page"`, using the same `isNavItemActive` rule as `BottomTabBar`. Both render `null` when not authenticated or no household — the desktop nav only exists after onboarding.',
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
  args: { isAuthenticated: true, hasHousehold: true },
  parameters: { nextjs: { navigation: { pathname: '/' } } },
  render: (args) => <NavigationLeft {...args} />,
}

export const RightWithHousehold: Story = {
  args: { isAuthenticated: true, hasHousehold: true },
  parameters: { nextjs: { navigation: { pathname: '/household' } } },
  render: (args) => <NavigationRight {...args} />,
}

export const BothAllVariants: Story = {
  args: { isAuthenticated: true, hasHousehold: true },
  parameters: {
    nextjs: { navigation: { pathname: '/' } },
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

function bothGroups(args: Story['args']) {
  return (
    <div className="flex items-center justify-between gap-8">
      <NavigationLeft {...args} />
      <NavigationRight {...args} />
    </div>
  )
}

const activeStory = (pathname: string, label: string): Story => ({
  args: { isAuthenticated: true, hasHousehold: true },
  parameters: {
    nextjs: { navigation: { pathname } },
    docs: {
      description: {
        story: `On \`${pathname}\`, "${label}" is the current page: foreground colour and \`aria-current="page"\`. Every other link stays muted.`,
      },
    },
  },
  render: (args) => bothGroups(args),
  play: async ({ canvasElement }) => {
    const current = within(canvasElement)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    await expect(current).toHaveLength(1)
    await expect(current[0]).toHaveAccessibleName(label)
  },
})

export const ActiveToday: Story = activeStory('/', 'Today')
export const ActiveShopping: Story = activeStory('/shopping', 'Pantry & shopping')
// `/pantry` is the same page at this width; it is only its own tab on a phone.
export const ActivePantry: Story = activeStory('/pantry', 'Pantry & shopping')
export const ActiveRecipesSubRoute: Story = activeStory('/recipes/imagine', 'My recipes')
export const ActiveHousehold: Story = activeStory('/household', 'Household')

export const HiddenWhenLoggedOut: Story = {
  args: { isAuthenticated: false, hasHousehold: false },
  parameters: {
    docs: {
      description: {
        story: 'Renders `null` for both left and right when not authenticated.',
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
  args: { isAuthenticated: true, hasHousehold: false },
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

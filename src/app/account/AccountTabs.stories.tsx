import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { AccountTabs } from './AccountTabs'

const meta = {
  title: 'Feature/Account/AccountTabs',
  component: AccountTabs,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The four tabs under "My account" (HON-1229, Reminders in HON-1256): Profile (`/account`), Reminders (`/account/reminders`), Connections (`/account/connections`) and Your data (`/account/data`). Each tab is a route, so a link can name one part. The bar is the shared `RouteTabs`: the current tab has `aria-current="page"`, the foreground colour and a 2px underline in the primary colour; the others are muted and turn primary on hover over 150ms. Each tab is at least 44px tall. At 360px the four do not fit, so the row scrolls sideways and the current tab scrolls into view.',
      },
    },
  },
} satisfies Meta<typeof AccountTabs>

export default meta
type Story = StoryObj<typeof meta>

function tabs(canvasElement: HTMLElement, name = 'Account sections') {
  return within(within(canvasElement).getByRole('navigation', { name }))
}

function currentTabs(canvasElement: HTMLElement, name?: string) {
  return tabs(canvasElement, name)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent)
}

/**
 * One row of 44px tabs that scrolls inside the nav, with the current tab in
 * view and the column not overflowing, so the page does not scroll sideways.
 */
async function expectScrollingRowWithCurrentInView(canvasElement: HTMLElement, name?: string) {
  const navElement = canvasElement.querySelector('nav')!
  const links = tabs(canvasElement, name).getAllByRole('link')
  const tops = new Set(links.map((link) => Math.round(link.getBoundingClientRect().top)))
  await expect(tops.size).toBe(1)
  for (const link of links) {
    await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  }
  await expect(navElement.scrollWidth).toBeGreaterThan(navElement.clientWidth)
  const column = within(canvasElement).getByTestId('column')
  await expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth)

  const current = links.find((link) => link.getAttribute('aria-current') === 'page')!
  const box = navElement.getBoundingClientRect()
  // 1px of slack: at full scroll a fractional label width can end a fraction
  // past the whole-pixel `scrollLeft`.
  await waitFor(() => {
    const rect = current.getBoundingClientRect()
    expect(rect.left).toBeGreaterThanOrEqual(box.left - 1)
    expect(rect.right).toBeLessThanOrEqual(box.right + 1)
  })
}

export const Profile: Story = {
  parameters: { nextjs: { navigation: { pathname: '/account' } } },
  play: async ({ canvasElement }) => {
    await expect(currentTabs(canvasElement)).toEqual(['Profile'])
  },
}

export const Reminders: Story = {
  parameters: { nextjs: { navigation: { pathname: '/account/reminders' } } },
  play: async ({ canvasElement }) => {
    await expect(currentTabs(canvasElement)).toEqual(['Reminders'])
  },
}

export const Connections: Story = {
  parameters: { nextjs: { navigation: { pathname: '/account/connections' } } },
  play: async ({ canvasElement }) => {
    await expect(currentTabs(canvasElement)).toEqual(['Connections'])
  },
}

export const YourData: Story = {
  parameters: { nextjs: { navigation: { pathname: '/account/data' } } },
  play: async ({ canvasElement }) => {
    await expect(currentTabs(canvasElement)).toEqual(['Your data'])
  },
}

/**
 * At 360px the four tabs scroll sideways, each at least 44px tall. Measured,
 * not assumed: the four English labels are wider than the column too.
 */
export const PhoneWidth: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/account/data' } },
    viewport: { defaultViewport: 'mobile1' },
  },
  decorators: [
    (Story) => (
      // 360px wide, less the page's `px-4` on each side.
      <div data-testid="column" className="w-[328px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await expectScrollingRowWithCurrentInView(canvasElement)
  },
}

/** On `/account/data` at 360px in Estonian, "Sinu andmed" shows on load. */
export const EstonianPhoneWidth: Story = {
  ...PhoneWidth,
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    const nav = tabs(canvasElement, 'Konto osad')
    await expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Profiil',
      'Meeldetuletused',
      'Ühendused',
      'Sinu andmed',
    ])
    await expect(currentTabs(canvasElement, 'Konto osad')).toEqual(['Sinu andmed'])
    await expectScrollingRowWithCurrentInView(canvasElement, 'Konto osad')
  },
}

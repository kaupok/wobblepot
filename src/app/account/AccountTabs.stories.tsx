import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { AccountTabs } from './AccountTabs'

const meta = {
  title: 'Feature/Account/AccountTabs',
  component: AccountTabs,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The three tabs under "My account" (HON-1229): Profile (`/account`), Connections (`/account/connections`) and Your data (`/account/data`). Each tab is a route, so a link can name one part. The current tab has `aria-current="page"`, the foreground colour and a 2px underline in the primary colour; the others are muted and turn primary on hover over 150ms. Each tab is at least 44px tall, and the three keep their natural width, so they fit one row at 360px in English and Estonian.',
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

/** One row, inside the nav's width, and each tab at least 44px tall. */
async function expectOneRowOfTouchTargets(canvasElement: HTMLElement, links: HTMLElement[]) {
  const tops = new Set(links.map((link) => Math.round(link.getBoundingClientRect().top)))
  await expect(tops.size).toBe(1)
  const navRight = canvasElement.querySelector('nav')!.getBoundingClientRect().right
  const right = Math.max(...links.map((link) => link.getBoundingClientRect().right))
  await expect(right).toBeLessThanOrEqual(navRight)
  for (const link of links) {
    await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  }
}

export const Profile: Story = {
  parameters: { nextjs: { navigation: { pathname: '/account' } } },
  play: async ({ canvasElement }) => {
    await expect(currentTabs(canvasElement)).toEqual(['Profile'])
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
 * The three tabs in one row at 360px, each at least 44px tall. Measured, not
 * assumed: the longest labels are "Connections" in English and "Sinu andmed"
 * in Estonian.
 */
export const PhoneWidth: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/account/connections' } },
    viewport: { defaultViewport: 'mobile1' },
  },
  decorators: [
    (Story) => (
      // 360px wide, less the page's `px-4` on each side.
      <div className="w-[328px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const links = tabs(canvasElement).getAllByRole('link')
    await expectOneRowOfTouchTargets(canvasElement, links)
  },
}

export const EstonianPhoneWidth: Story = {
  ...PhoneWidth,
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    const nav = tabs(canvasElement, 'Konto osad')
    const links = nav.getAllByRole('link')
    await expect(links.map((link) => link.textContent)).toEqual([
      'Profiil',
      'Ühendused',
      'Sinu andmed',
    ])
    await expect(currentTabs(canvasElement, 'Konto osad')).toEqual(['Ühendused'])
    await expectOneRowOfTouchTargets(canvasElement, links)
  },
}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor, within } from 'storybook/test'

import { RouteTabs } from './RouteTabs'

const THREE_TABS = [
  { key: 'profile', href: '/account', label: 'Profile' },
  { key: 'connections', href: '/account/connections', label: 'Connections' },
  { key: 'data', href: '/account/data', label: 'Your data' },
]

// The My account tabs in Estonian, the widest set: about 400px of labels.
const FOUR_ESTONIAN_TABS = [
  { key: 'profile', href: '/account', label: 'Profiil' },
  { key: 'reminders', href: '/account/reminders', label: 'Meeldetuletused' },
  { key: 'connections', href: '/account/connections', label: 'Ühendused' },
  { key: 'data', href: '/account/data', label: 'Sinu andmed' },
]

// The Household tabs in Estonian: about 420px of labels.
const FOUR_ESTONIAN_HOUSEHOLD_TABS = [
  { key: 'members', href: '/household', label: 'Liikmed' },
  { key: 'mealPreferences', href: '/household/meal-preferences', label: 'Toidueelistused' },
  { key: 'ingredients', href: '/household/ingredients', label: 'Koostisosad' },
  { key: 'settings', href: '/household/settings', label: 'Seaded' },
]

const meta = {
  title: 'Components/RouteTabs',
  component: RouteTabs,
  tags: ['autodocs'],
  args: { tabs: THREE_TABS, label: 'Account sections' },
  parameters: {
    nextjs: { navigation: { pathname: '/account' } },
    docs: {
      description: {
        component:
          'A row of tabs, each a route (HON-1229, shared in HON-1256): My account uses it, and the household page will. The current tab (exact path match) has `aria-current="page"`, the foreground colour and a 2px underline in the primary colour; the others are muted and turn primary on hover over 150ms. Each tab is at least 44px tall and keeps its natural width. When the row does not fit, it scrolls sideways and the page does not; the 1px rule runs under every tab while it scrolls, and the current tab scrolls into view on load, clear of the edge fades. The scrollbar is hidden, so each edge with tabs past it fades out (HON-1468); the fade stops above the underline and lets taps through.',
      },
    },
  },
} satisfies Meta<typeof RouteTabs>

export default meta
type Story = StoryObj<typeof meta>

function parts(canvasElement: HTMLElement, name: string) {
  const nav = within(canvasElement).getByRole('navigation', { name })
  const fade = (edge: 'start' | 'end') =>
    nav.parentElement!.querySelector<HTMLElement>(`[data-edge="${edge}"]`)!
  return { nav, list: nav.querySelector('ul')!, links: within(nav).getAllByRole('link'), fade }
}

/**
 * The row's edge fades in a narrow column: the end fades while tabs are past
 * it, a tap through the fade lands on the tab under it, the underline runs
 * below the fade, and at the end of the row the fade moves to the start.
 */
async function expectEdgeFades(canvasElement: HTMLElement, name: string) {
  const { nav, links, fade } = parts(canvasElement, name)
  await waitFor(() => expect(fade('end')).toHaveAttribute('data-visible', 'true'))
  await expect(fade('start')).toHaveAttribute('data-visible', 'false')
  const fadeBox = fade('end').getBoundingClientRect()
  await expect(Math.round(fadeBox.right)).toBe(Math.round(nav.getBoundingClientRect().right))
  // A tap at the fade's middle reaches the tab beneath it.
  const hit = document.elementFromPoint(
    fadeBox.left + fadeBox.width / 2,
    fadeBox.top + fadeBox.height / 2,
  )
  await expect(links).toContain(hit?.closest('a'))
  // The 2px underline sits below the fade.
  const current = within(nav).getByRole('link', { current: 'page' })
  await expect(fadeBox.bottom).toBeLessThanOrEqual(current.getBoundingClientRect().bottom - 2)

  nav.scrollLeft = nav.scrollWidth
  await waitFor(() => expect(fade('end')).toHaveAttribute('data-visible', 'false'))
  await expect(fade('start')).toHaveAttribute('data-visible', 'true')
}

/**
 * Whether the link sits inside the nav's visible box. 1px of slack: at full
 * scroll a fractional label width can end a fraction past the whole-pixel
 * `scrollLeft`.
 */
function isInView(nav: HTMLElement, link: HTMLElement) {
  const box = nav.getBoundingClientRect()
  const rect = link.getBoundingClientRect()
  return rect.left >= box.left - 1 && rect.right <= box.right + 1
}

export const ThreeTabs: Story = {
  play: async ({ canvasElement }) => {
    const { nav, links } = parts(canvasElement, 'Account sections')
    const current = links.filter((link) => link.getAttribute('aria-current') === 'page')
    await expect(current.map((link) => link.textContent)).toEqual(['Profile'])
    for (const link of links) {
      await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
    // Wide enough: nothing to scroll.
    await expect(nav.scrollWidth).toBeLessThanOrEqual(nav.clientWidth)
  },
}

const phoneWidth: Pick<Story, 'parameters' | 'decorators'> = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  decorators: [
    (Story) => (
      // 360px wide, less the page's `px-4` on each side.
      <div data-testid="column" className="w-[328px]">
        <Story />
      </div>
    ),
  ],
}

/**
 * Four Estonian tabs at 360px: the row scrolls sideways inside the column,
 * the column itself does not overflow, and the rule under the tabs is as wide
 * as the scrolled row, so the underline stays on it.
 */
export const FourEstonianTabsAtPhoneWidth: Story = {
  ...phoneWidth,
  args: { tabs: FOUR_ESTONIAN_TABS, label: 'Konto osad' },
  play: async ({ canvasElement }) => {
    const { nav, list, links } = parts(canvasElement, 'Konto osad')
    await expect(nav.scrollWidth).toBeGreaterThan(nav.clientWidth)
    const column = within(canvasElement).getByTestId('column')
    await expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth)
    await expect(list.offsetWidth).toBe(nav.scrollWidth)
    // No scrollbar band under the row, even with classic scrollbars.
    await expect(nav.offsetHeight).toBe(list.offsetHeight)
    const tops = new Set(links.map((link) => Math.round(link.getBoundingClientRect().top)))
    await expect(tops.size).toBe(1)
    for (const link of links) {
      await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
    await expectEdgeFades(canvasElement, 'Konto osad')
  },
}

const phone390: Pick<Story, 'parameters' | 'decorators'> = {
  parameters: { viewport: { defaultViewport: 'mobileIphone' } },
  decorators: [
    (Story) => (
      // 390px wide, less the page's `px-4` on each side.
      <div className="w-[358px]">
        <Story />
      </div>
    ),
  ],
}

/**
 * My account in Estonian at 390px: "Sinu andmed" starts wholly past the edge,
 * and the end fade says the row goes on (HON-1468).
 */
export const EstonianAccountTabsAt390: Story = {
  ...phone390,
  args: { tabs: FOUR_ESTONIAN_TABS, label: 'Konto osad' },
  play: async ({ canvasElement }) => {
    await expectEdgeFades(canvasElement, 'Konto osad')
  },
}

/**
 * Household in Estonian at 390px: "Seaded" starts wholly past the edge, and
 * the end fade says the row goes on (HON-1468).
 */
export const EstonianHouseholdTabsAt390: Story = {
  ...phone390,
  parameters: { ...phone390.parameters, nextjs: { navigation: { pathname: '/household' } } },
  args: { tabs: FOUR_ESTONIAN_HOUSEHOLD_TABS, label: 'Leibkonna osad' },
  play: async ({ canvasElement }) => {
    await expectEdgeFades(canvasElement, 'Leibkonna osad')
  },
}

/**
 * A deep link to the last tab: "Sinu andmed" starts past the column's right
 * edge, and the row scrolls it into view on load.
 */
export const CurrentTabStartsOutOfView: Story = {
  ...FourEstonianTabsAtPhoneWidth,
  parameters: {
    ...phoneWidth.parameters,
    nextjs: { navigation: { pathname: '/account/data' } },
  },
  play: async ({ canvasElement }) => {
    const { nav } = parts(canvasElement, 'Konto osad')
    const current = within(nav).getByRole('link', { current: 'page' })
    await expect(current).toHaveTextContent('Sinu andmed')
    await waitFor(() => expect(isInView(nav, current)).toBe(true))
    await expect(nav.scrollLeft).toBeGreaterThan(0)
    // At the end of the row: the fade moves to the start edge.
    const { fade } = parts(canvasElement, 'Konto osad')
    await waitFor(() => expect(fade('start')).toHaveAttribute('data-visible', 'true'))
    await expect(fade('end')).toHaveAttribute('data-visible', 'false')
  },
}

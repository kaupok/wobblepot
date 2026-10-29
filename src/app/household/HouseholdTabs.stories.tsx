import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor, within } from 'storybook/test'

import { HouseholdTabs } from './HouseholdTabs'

const meta = {
  title: 'Feature/Household/HouseholdTabs',
  component: HouseholdTabs,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The four tabs under "Household" (HON-1257, HON-1264): Members (`/household`), Meal preferences (`/household/meal-preferences`), Ingredients (`/household/ingredients`) and Settings (`/household/settings`). Each tab is a route, so a link can name one part. The bar is the shared `RouteTabs`: the current tab has `aria-current="page"`, the foreground colour and a 2px underline in the primary colour. Each tab is at least 44px tall. When the four do not fit, the row scrolls sideways and the page does not.',
      },
    },
  },
} satisfies Meta<typeof HouseholdTabs>

export default meta
type Story = StoryObj<typeof meta>

function tabs(canvasElement: HTMLElement, name = 'Household sections') {
  return within(within(canvasElement).getByRole('navigation', { name }))
}

function currentTabs(canvasElement: HTMLElement, name?: string) {
  return tabs(canvasElement, name)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent)
}

/**
 * One row of 44px tabs with the current tab inside the nav, and the column
 * not overflowing, so the page does not scroll sideways. Whether the row
 * itself scrolls depends on the label widths, so it is not asserted.
 */
async function expectOneRowInColumn(canvasElement: HTMLElement, name?: string) {
  const navElement = canvasElement.querySelector('nav')!
  const links = tabs(canvasElement, name).getAllByRole('link')
  const tops = new Set(links.map((link) => Math.round(link.getBoundingClientRect().top)))
  await expect(tops.size).toBe(1)
  for (const link of links) {
    await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  }
  const column = within(canvasElement).getByTestId('column')
  await expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth)

  const current = links.find((link) => link.getAttribute('aria-current') === 'page')!
  const box = navElement.getBoundingClientRect()
  // 1px of slack: a fractional label width can end past a whole-pixel scroll.
  // `waitFor`: `RouteTabs` reveals the current tab in an effect.
  await waitFor(() => {
    const rect = current.getBoundingClientRect()
    expect(rect.left).toBeGreaterThanOrEqual(box.left - 1)
    expect(rect.right).toBeLessThanOrEqual(box.right + 1)
  })
}

export const Members: Story = {
  parameters: { nextjs: { navigation: { pathname: '/household' } } },
  play: async ({ canvasElement }) => {
    await expect(currentTabs(canvasElement)).toEqual(['Members'])
  },
}

export const MealPreferences: Story = {
  parameters: { nextjs: { navigation: { pathname: '/household/meal-preferences' } } },
  play: async ({ canvasElement }) => {
    await expect(currentTabs(canvasElement)).toEqual(['Meal preferences'])
  },
}

export const Ingredients: Story = {
  parameters: { nextjs: { navigation: { pathname: '/household/ingredients' } } },
  play: async ({ canvasElement }) => {
    await expect(currentTabs(canvasElement)).toEqual(['Ingredients'])
  },
}

export const Settings: Story = {
  parameters: { nextjs: { navigation: { pathname: '/household/settings' } } },
  play: async ({ canvasElement }) => {
    await expect(currentTabs(canvasElement)).toEqual(['Settings'])
  },
}

/** At 360px the four tabs sit in one row of 44px tabs inside the column. */
export const PhoneWidth: Story = {
  parameters: {
    nextjs: { navigation: { pathname: '/household/settings' } },
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
    await expectOneRowInColumn(canvasElement)
  },
}

/** On `/household/settings` at 360px in Estonian, "Seaded" shows on load. */
export const EstonianPhoneWidth: Story = {
  ...PhoneWidth,
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    const nav = tabs(canvasElement, 'Leibkonna osad')
    await expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Liikmed',
      'Toidueelistused',
      'Koostisosad',
      'Seaded',
    ])
    await expect(currentTabs(canvasElement, 'Leibkonna osad')).toEqual(['Seaded'])
    await expectOneRowInColumn(canvasElement, 'Leibkonna osad')
  },
}

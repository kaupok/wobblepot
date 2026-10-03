import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Card, CardContent } from '@/components/ui/card'
import { Heading } from '@/components/ui/typography'
import { mealHueStyle } from './MealImageCard'
import { MyRecipeIcon } from './MyRecipeIcon'

const meta = {
  title: 'Meal plan/MyRecipeIcon',
  component: MyRecipeIcon,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          "Marks one of the household's own recipes: the bare `BookOpen` icon the header and tab bar use for My recipes, after the meal's name, with the label as the trigger's accessible name and in a shadcn `Tooltip` that opens on hover and on keyboard focus (HON-973). The planner and selector cards use the default size, a 14px icon in an `icon-xs` button. The cook view uses `lg` after its `display` title: the `icon-display` button, a 24px box with a 44px target, and the `lg` tooltip (HON-1023).",
      },
    },
  },
} satisfies Meta<typeof MyRecipeIcon>

export default meta
type Story = StoryObj<typeof meta>

const LONG_NAME = 'Grandma’s slow-roasted lemon garlic chicken with rice'

/**
 * After a meal name that wraps, as on the planner and selector cards (HON-973):
 * the bare icon, no pill, on the name's last line.
 */
function IconAfterName() {
  return (
    <div className="w-48">
      <Heading variant="section" as="h3">
        {LONG_NAME}
        {'\u00a0'}
        <MyRecipeIcon />
      </Heading>
    </div>
  )
}

async function expectTooltip() {
  const tooltip = await within(document.body).findByRole('tooltip')
  await expect(tooltip).toHaveTextContent('My recipe')
}

/** The icon is on the heading's last line, not on a line of its own. */
async function expectOnLastLine(heading: HTMLElement, trigger: HTMLElement) {
  const box = heading.getBoundingClientRect()
  const icon = trigger.getBoundingClientRect()
  await expect(box.bottom - icon.bottom).toBeLessThan(icon.height)
  await expect(box.height).toBeGreaterThan(icon.height * 2)
}

export const IconAfterNameHover: Story = {
  name: 'Icon after a name (hover)',
  render: () => <IconAfterName />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'My recipe' })
    await expect(trigger).not.toHaveAttribute('title')
    await expect(trigger.closest('[data-slot="badge"]')).toBeNull()
    // The icon is the old badge's 14px, and sits on the name's last line.
    const icon = trigger.querySelector('svg')!.getBoundingClientRect()
    await expect(icon.width).toBe(14)
    await expectOnLastLine(canvas.getByRole('heading'), trigger)

    await userEvent.hover(trigger)
    await expectTooltip()
    await userEvent.unhover(trigger)
    await waitFor(() =>
      expect(within(document.body).queryByRole('tooltip')).not.toBeInTheDocument(),
    )
  },
}

export const IconAfterNameFocus: Story = {
  name: 'Icon after a name (keyboard focus)',
  render: () => <IconAfterName />,
  play: async ({ canvasElement }) => {
    await userEvent.tab()
    await expect(within(canvasElement).getByRole('button', { name: 'My recipe' })).toHaveFocus()
    await expectTooltip()
  },
}

export const IconAfterNameDark: Story = {
  name: 'Icon after a name (dark)',
  render: () => <IconAfterName />,
  globals: { theme: 'dark' },
}

/**
 * `lg` after the cook view's `display` title on a tinted meal surface
 * (HON-1023). The first title fits on one line, so it is measured against the
 * same name without the icon; the second wraps, so the icon must follow its
 * last word.
 */
function CookViewTitles() {
  return (
    <Card data-meal-surface="" style={mealHueStyle(52)} className="w-80">
      <CardContent className="flex flex-col gap-4 p-4">
        <Heading variant="display" data-testid="without-icon">
          Fish tacos
        </Heading>
        <Heading variant="display" data-testid="with-icon">
          Fish tacos{'\u00a0'}
          <MyRecipeIcon size="lg" />
        </Heading>
        <Heading variant="display" data-testid="wrapping">
          {LONG_NAME}
          {'\u00a0'}
          <MyRecipeIcon size="lg" />
        </Heading>
      </CardContent>
    </Card>
  )
}

async function expectCookViewTitles(canvasElement: HTMLElement, iconSize: number) {
  const canvas = within(canvasElement)
  // The title's line height does not change with the icon.
  const without = canvas.getByTestId('without-icon').getBoundingClientRect()
  const withIcon = canvas.getByTestId('with-icon')
  await expect(withIcon.getBoundingClientRect().height).toBe(without.height)

  const trigger = within(withIcon).getByRole('button', { name: 'My recipe' })
  await expect(trigger).toHaveAttribute('data-size', 'icon-display')
  await expect(trigger.querySelector('svg')!.getBoundingClientRect().width).toBe(iconSize)
  // A 24px box whose `::after` reaches 10px past it: a 44px target.
  const box = trigger.getBoundingClientRect()
  await expect(box.width).toBe(24)
  const after = getComputedStyle(trigger, '::after')
  for (const side of [after.top, after.right, after.bottom, after.left]) {
    await expect(side).toBe('-10px')
  }

  const wrapping = canvas.getByTestId('wrapping')
  await expectOnLastLine(wrapping, within(wrapping).getByRole('button'))
}

export const CookViewTitlePhone: Story = {
  name: 'Cook view title, lg (phone)',
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  render: () => <CookViewTitles />,
  play: async ({ canvasElement }) => {
    await expectCookViewTitles(canvasElement, 20)
    const trigger = within(within(canvasElement).getByTestId('with-icon')).getByRole('button')
    // A phone has no hover: a tap opens the label, and a second tap closes it.
    await userEvent.pointer({ keys: '[TouchA]', target: trigger })
    await expectTooltip()
    await userEvent.pointer({ keys: '[TouchA]', target: trigger })
    await waitFor(() =>
      expect(within(document.body).queryByRole('tooltip')).not.toBeInTheDocument(),
    )
  },
}

export const CookViewTitleDesktop: Story = {
  name: 'Cook view title, lg (desktop)',
  globals: { viewport: { value: 'laptop', isRotated: false } },
  render: () => <CookViewTitles />,
  play: async ({ canvasElement }) => {
    await expectCookViewTitles(canvasElement, 24)
    await userEvent.tab()
    await expect(
      within(within(canvasElement).getByTestId('with-icon')).getByRole('button'),
    ).toHaveFocus()
    await expectTooltip()
  },
}

export const CookViewTitleDark: Story = {
  name: 'Cook view title, lg (dark)',
  render: () => <CookViewTitles />,
  globals: { theme: 'dark' },
}

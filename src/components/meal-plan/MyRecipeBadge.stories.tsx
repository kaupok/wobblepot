import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Card, CardContent } from '@/components/ui/card'
import { Heading } from '@/components/ui/typography'
import { mealHueStyle } from './MealImageCard'
import { MyRecipeBadge, MyRecipeIcon } from './MyRecipeBadge'
import { ProteinBadge } from './ProteinBadge'

const meta = {
  title: 'Meal plan/MyRecipeBadge',
  component: MyRecipeBadge,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          "Marks one of the household's own recipes. In the cook view, a labelled `secondary` badge with the `BookOpen` icon the header and tab bar use for My recipes: on a tinted meal surface `[data-meal-surface]` re-scopes `--secondary` to the meal's chip colour (HON-948). On the planner and selector cards, `MyRecipeIcon`: the bare icon after the meal's name, with the label as the trigger's accessible name and in a shadcn `Tooltip` that opens on hover and on keyboard focus (HON-973).",
      },
    },
  },
} satisfies Meta<typeof MyRecipeBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Labelled: Story = {
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement).getByText('My recipe')
    await expect(badge).toHaveAttribute('data-slot', 'badge')
    await expect(badge).not.toHaveAttribute('title')
  },
}

export const LabelledDark: Story = {
  globals: { theme: 'dark' },
}

/** `lg`, the cook view's size (HON-932). */
export const Large: Story = {
  args: { size: 'lg' },
}

const LONG_NAME = 'Grandma’s slow-roasted lemon garlic chicken with rice'

/**
 * `MyRecipeIcon` after a meal name that wraps, as on the planner and selector
 * cards (HON-973): the bare icon, no pill, on the name's last line.
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

export const IconAfterNameHover: Story = {
  name: 'Icon after a name (hover)',
  render: () => <IconAfterName />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'My recipe' })
    await expect(trigger).not.toHaveAttribute('title')
    await expect(trigger.closest('[data-slot="badge"]')).toBeNull()
    // The icon is the badge's 14px, and sits on the name's last line.
    const icon = trigger.querySelector('svg')!.getBoundingClientRect()
    await expect(icon.width).toBe(14)
    const heading = canvas.getByRole('heading').getBoundingClientRect()
    await expect(heading.bottom - icon.bottom).toBeLessThan(icon.height)
    await expect(heading.height).toBeGreaterThan(icon.height * 2)

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

/** Inside a tinted meal surface, the chip takes the meal's hue. */
function TintedSurface({ hue }: { hue: number }) {
  return (
    <Card data-meal-surface="" style={mealHueStyle(hue)}>
      <CardContent className="flex items-center gap-1.5 p-4">
        <ProteinBadge proteinType="poultry" />
        <MyRecipeBadge />
      </CardContent>
    </Card>
  )
}

export const TintedSurfaceLight: Story = {
  render: () => (
    <div className="flex gap-3">
      <TintedSurface hue={52} />
      <TintedSurface hue={150} />
      <TintedSurface hue={280} />
    </div>
  ),
}

export const TintedSurfaceDark: Story = {
  ...TintedSurfaceLight,
  globals: { theme: 'dark' },
}

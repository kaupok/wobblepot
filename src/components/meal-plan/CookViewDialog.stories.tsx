import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { ReactNode } from 'react'
import { expect, fn, within } from 'storybook/test'

import { Body } from '@/components/ui/typography'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'

import { CookViewDialog } from './CookViewDialog'

const meta = {
  title: 'Meal plan/CookViewDialog',
  component: CookViewDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The cook view’s dialog shell: the full-screen panel and its tint, the hero, the title with the "My recipe" mark, the phone’s sticky bar, the wake lock, and focus in and out. `MealDetailModal` (a planned entry) and `RecipeDetailModal` (a My recipes recipe, HON-1338) fill it with `MealDetail`. Here the body is a placeholder that shows the hero and title it is handed.',
      },
    },
  },
  args: {
    meal: { name: 'Lemon-garlic roast chicken', isCustom: true },
    open: true,
    onOpenChange: fn(),
    image: { status: 'ready', imageUrl: mealIllustration.src, imageHue: 52 },
    children: ({ image, title }) => (
      <div data-slot="cook-view-scroll" className="flex flex-col gap-4 overflow-y-auto p-8">
        {image}
        {title}
        <Body>The view’s body goes here.</Body>
      </div>
    ),
  },
} satisfies Meta<typeof CookViewDialog>

export default meta
type Story = StoryObj<typeof meta>

/** Tinted by the image's hue; the dialog is named by the meal. */
export const WithImage: Story = {
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', {
      name: 'Lemon-garlic roast chicken',
    })
    await expect(dialog).toHaveAttribute('data-meal-surface', '')
  },
}

/** No image: the plain background, and no hero. */
export const WithoutImage: Story = {
  args: {
    meal: { name: 'Lentil soup' },
    image: { status: 'none', imageUrl: null, imageHue: null },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Lentil soup' })
    await expect(dialog).not.toHaveAttribute('data-meal-surface')
  },
}

/** The title in a column the play function resizes. */
function NarrowTitle({ title }: { title: ReactNode }) {
  return (
    <div data-slot="cook-view-scroll" className="p-8">
      <div data-testid="title-column" className="w-[286px]">
        {title}
      </div>
    </div>
  )
}

/**
 * At every column width from 120px to 480px, the icon and the name's last
 * word share one line box: the `nowrap` span that holds them has a single
 * rect, and the icon's centre sits inside it. The sweep crosses the width
 * where the icon broke onto its own line, whatever the font's metrics.
 */
async function expectIconOnLastWordLine(name: string) {
  const body = within(document.body)
  // The dialog's name is the meal name alone, without "My recipe".
  await body.findByRole('dialog', { name })
  const column = body.getByTestId('title-column')
  const icon = body.getByRole('button', { name: 'My recipe' })
  const glue = icon.parentElement!
  await expect(glue).toHaveClass('whitespace-nowrap')
  for (let width = 120; width <= 480; width += 2) {
    column.style.width = `${width}px`
    const line = glue.getBoundingClientRect()
    const iconBox = icon.getBoundingClientRect()
    const iconCentre = iconBox.top + iconBox.height / 2
    await expect({ width, rects: glue.getClientRects().length }).toEqual({ width, rects: 1 })
    await expect(iconCentre).toBeGreaterThan(line.top)
    await expect(iconCentre).toBeLessThan(line.bottom)
  }
  column.style.width = ''
}

/**
 * "Shakshuka for One", which fits one line in the 286px left column at 1280px
 * while, before HON-1469, the icon wrapped onto a second line by itself.
 */
export const IconStaysWithLastWord: Story = {
  args: {
    meal: { name: 'Shakshuka for One', isCustom: true },
    children: NarrowTitle,
  },
  play: async () => {
    await expectIconOnLastWordLine('Shakshuka for One')
  },
}

/** A long name wraps between its words, and the icon follows the last one. */
export const LongNameWraps: Story = {
  args: {
    meal: { name: 'Slow-roasted tomato and white bean stew with crispy sage', isCustom: true },
    children: NarrowTitle,
  },
  play: async () => {
    const name = 'Slow-roasted tomato and white bean stew with crispy sage'
    await expectIconOnLastWordLine(name)
    const title = within(document.body).getByRole('heading', { name: /Slow-roasted/ })
    const icon = within(document.body).getByRole('button', { name: 'My recipe' })
    // More than one line: the heading is over twice the icon's height.
    await expect(title.getBoundingClientRect().height).toBeGreaterThan(
      icon.getBoundingClientRect().height * 2,
    )
  },
}

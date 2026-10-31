import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { CSSProperties } from 'react'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { PortionNutrition } from './PortionNutrition'

const TROUT = { calories: 520, protein: 38, carbs: 30, fat: 22 }

const meta = {
  title: 'Meal plan/PortionNutrition',
  component: PortionNutrition,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The cook view’s nutrition, per serving or for one member’s plate (HON-1475). The caption beside the calories opens a list of members; picking one multiplies the per-serving values by their portion (HON-1505). The view opens on the signed-in member’s portion when it is not 1×. With every member at 1×, or no members, the caption is plain text.',
      },
    },
  },
  args: { nutrition: TROUT, size: 'lg' },
  decorators: [
    (Story) => (
      // The cook view's nutrition column on a phone.
      <div className="w-87.5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PortionNutrition>

export default meta
type Story = StoryObj<typeof meta>

const PORTIONS = [
  { id: 'm1', name: 'Kaupo', multiplier: 1.5, isSelf: true },
  { id: 'm2', name: 'Mari', multiplier: 1, isSelf: false },
  { id: 'm3', name: 'Nora', multiplier: 0.5, isSelf: false },
]

/**
 * Opens the caption's list, picks one option and waits out the close animation:
 * Radix blocks pointer events on the page until the list is gone.
 */
async function pick(trigger: HTMLElement, name: string) {
  await userEvent.click(trigger)
  await userEvent.click(await screen.findByRole('option', { name }))
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  await waitFor(() => expect(document.body.style.pointerEvents).toBe(''))
}

/** Two adults and a toddler; the signed-in adult eats 1.5×, so the view opens on their portion. */
export const Members: Story = {
  args: { portions: PORTIONS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('radio')).not.toBeInTheDocument()
    const trigger = canvas.getByRole('combobox', { name: 'Whose portion Kaupo, 1.5× portion' })
    await expect(canvas.getByText('57g')).toBeVisible()

    // The 44px touch floor on a phone, the default story viewport: the
    // trigger's `::after`, centred on the fine-print line.
    const after = getComputedStyle(trigger, '::after')
    await expect(after.position).toBe('absolute')
    await expect(after.height).toBe('44px')
    // The hit area stops at the trigger's edge, so it never covers a button beside it.
    await expect(after.left).toBe('0px')
    await expect(after.right).toBe('0px')

    await userEvent.click(trigger)
    for (const option of await screen.findAllByRole('option')) {
      // `offsetHeight`, because the open animation scales the list to 95%.
      await expect(option.offsetHeight).toBeGreaterThanOrEqual(44)
    }
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    await waitFor(() => expect(document.body.style.pointerEvents).toBe(''))

    await pick(trigger, 'Nora 0.5×')
    await expect(canvas.getByText('19g')).toBeVisible()
    await expect(trigger).toHaveTextContent('Nora, 0.5× portion')

    await pick(trigger, 'Per serving')
    await expect(canvas.getByText('38g')).toBeVisible()
    await expect(trigger).toHaveTextContent('per serving')
  },
}

/** Inside a meal's tint, as in the cook view: the caption takes the tint's muted text colour. */
export const OnTintedSurface: Story = {
  name: 'On a tinted surface',
  args: { portions: PORTIONS, components: [{ isVague: true }] },
  decorators: [
    (Story) => (
      // `--meal-hue` is the one per-meal value (docs/DESIGN.md → Imagery).
      <div data-meal-surface="" style={{ '--meal-hue': 52 } as CSSProperties} className="p-4">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('combobox', { name: /^Whose portion/ })
    // The trigger takes the fine-print line's colour, which the tint re-scopes.
    await expect(getComputedStyle(trigger).color).toBe(
      getComputedStyle(trigger.parentElement!).color,
    )
    // No field chrome on the tint: no border, no background.
    await expect(getComputedStyle(trigger).borderTopWidth).toBe('0px')
    await expect(getComputedStyle(trigger).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    // The (i) stays after the caption, outside the trigger.
    const info = canvas.getByRole('button', { name: 'About these numbers' })
    await expect(trigger.contains(info)).toBe(false)
    await expect(info.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      trigger.getBoundingClientRect().right,
    )
  },
}

/** Every member at 1×: each option would repeat "Per serving", so the caption is plain text. */
export const AllOneTimes: Story = {
  name: 'All at 1× (plain caption)',
  args: {
    portions: [
      { id: 'm1', name: 'Kaupo', multiplier: 1, isSelf: true },
      { id: 'm2', name: 'Mari', multiplier: 1, isSelf: false },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('combobox')).not.toBeInTheDocument()
    await expect(canvas.getByText('per serving')).toBeVisible()
  },
}

/** No household (the landing deck), or the members are loading or failed. */
export const NoMembers: Story = {
  name: 'No members',
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('combobox')).not.toBeInTheDocument()
  },
}

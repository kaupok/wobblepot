import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { MealsToPlanForm } from './MealsToPlanForm'

const meta = {
  title: 'Feature/Household/MealsToPlanForm',
  component: MealsToPlanForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Household → Meal preferences (HON-1257): the Meals to plan section, below Food preferences. One grid with the meals as columns and Weekdays / Weekends as rows (HON-962), its own form with a Save button shown only while it has a change (HON-961).',
      },
    },
  },
  args: {
    preferences: {
      dietaryType: null,
      allergensToAvoid: [],
      restrictions: [],
      excludedIngredients: [],
      weekdayMealTypes: ['dinner'],
      weekendMealTypes: ['dinner'],
    },
    isOwner: true,
  },
} satisfies Meta<typeof MealsToPlanForm>

export default meta
type Story = StoryObj<typeof meta>

// The body of the last PATCH the route received, for the payload assertion.
let lastPreferencesBody: unknown

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('checkbox', { name: 'Weekdays: Dinner' })).toBeChecked()
    await expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  },
}

export const NonOwner: Story = {
  args: { isOwner: false },
  parameters: {
    docs: {
      description: {
        story:
          "Non-owner viewer: every checkbox is disabled and there is no save button. The route is owner-only (HON-677); the notice is the page's (HON-960).",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const checkbox of canvas.getAllByRole('checkbox')) {
      await expect(checkbox).toBeDisabled()
    }
    await expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  },
}

export const Dirty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/households/me/preferences', async ({ request }) => {
          lastPreferencesBody = await request.json()
          return HttpResponse.json({})
        }),
      ],
    },
    docs: {
      description: {
        story:
          'Lunch added to the weekend: the section shows its Save button. Each checkbox names both axes ("Weekends: Lunch"). Saving sends only the two meal-type lists, so the food preferences are left as they are.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    lastPreferencesBody = undefined
    const canvas = within(canvasElement)
    const table = canvas.getByRole('table', { name: 'Meals to plan' })
    const weekendLunch = within(table).getByRole('checkbox', { name: 'Weekends: Lunch' })
    await userEvent.click(weekendLunch)
    await expect(weekendLunch).toBeChecked()
    const save = canvas.getByRole('button', { name: 'Save' })
    await expect(save).toBeVisible()

    await userEvent.click(save)
    await waitFor(() =>
      expect(lastPreferencesBody).toEqual({
        weekdayMealTypes: ['dinner'],
        weekendMealTypes: ['dinner', 'lunch'],
      }),
    )
  },
}

export const Desktop: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'Desktop width with a change. "Save" is as wide as its label and starts at the column edge; on a phone it fills the column (HON-782).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Weekdays: Lunch'))
    const button = canvas.getByRole('button', { name: 'Save' })
    await expect(button.getBoundingClientRect().width).toBeLessThan(
      button.parentElement!.getBoundingClientRect().width,
    )
  },
}

export const Phone: Story = {
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story: 'Phone width with a change: "Save" fills the column and the grid does not overflow.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const grid = canvasElement.querySelector<HTMLElement>('[data-slot="table-container"]')!
    await expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth)

    await userEvent.click(canvas.getByLabelText('Weekdays: Lunch'))
    const button = canvas.getByRole('button', { name: 'Save' })
    await expect(button.getBoundingClientRect().width).toBe(
      button.parentElement!.getBoundingClientRect().width,
    )
  },
}

/**
 * Estonian at phone width, inside the page's `px-4` gutters. The Estonian meal
 * heads are the widest single words in the grid, so below `sm` each row head
 * sits on its own row above its checkboxes, and Dinner stays in view (HON-962).
 */
export const PhoneEstonian: Story = {
  globals: { viewport: { value: 'mobileIphone', isRotated: false }, locale: 'et' },
  decorators: [
    (Story) => (
      <div className="px-4">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = canvas.getByRole('table', { name: 'Planeeritavad toidud' })
    const grid = table.parentElement!
    await expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth)
    // One visible row head per day group, above its checkboxes.
    await expect(within(table).getAllByRole('rowheader')).toEqual([
      within(table).getByRole('rowheader', { name: 'Argipäevad' }),
      within(table).getByRole('rowheader', { name: 'Nädalavahetus' }),
    ])
    const dinner = within(table).getByRole('checkbox', { name: 'Nädalavahetus: Õhtusöök' })
    await expect(dinner.getBoundingClientRect().right).toBeLessThanOrEqual(
      grid.getBoundingClientRect().right,
    )
    const form = canvas.getByRole('form')
    await expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth)
  },
}

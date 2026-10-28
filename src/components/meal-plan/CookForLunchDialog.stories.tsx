import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { CookForLunchDialog } from './CookForLunchDialog'

const meta = {
  title: 'Meal plan/CookForLunchDialog',
  component: CookForLunchDialog,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          "\"Cook for tomorrow's lunch too\" from a planned dinner's ⋯ menu (HON-1396): how many servings of the dinner become the next day's lunch. Confirm adds one leftover item to that lunch, and the dinner cooks that much more.",
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    planId: 'plan-1',
    entryId: 'entry-curry',
    mealName: 'Chicken curry',
    householdServings: 2.5,
  },
} satisfies Meta<typeof CookForLunchDialog>

export default meta
type Story = StoryObj<typeof meta>

/** Starts at the household's servings; Confirm closes the dialog. */
export const Default: Story = {
  play: async ({ args }) => {
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: "Cook for tomorrow's lunch too" }),
    )
    const servings = within(dialog.getByRole('group', { name: 'Servings for lunch' }))
    await expect(servings.getByText('2.5 servings')).toBeInTheDocument()
    await userEvent.click(servings.getByRole('button', { name: 'Fewer servings' }))
    await expect(servings.getByText('2 servings')).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Add to lunch' }))
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
  },
}

/** A refusal keeps the dialog open; the toast says why in catalog copy. */
export const Refused: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/meal-plans/:planId/entries/:entryId/leftover-lunch', () =>
          HttpResponse.json(
            { error: 'Leftover lunch refused: recipeLunch', code: 'recipeLunch' },
            { status: 409 },
          ),
        ),
      ],
    },
  },
  play: async ({ args }) => {
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: "Cook for tomorrow's lunch too" }),
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Add to lunch' }))
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Add to lunch' })).toBeVisible())
    await expect(args.onOpenChange).not.toHaveBeenCalled()
  },
}

export const Estonian: Story = {
  globals: { locale: 'et' },
  play: async () => {
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Tee ka homseks lõunaks' }),
    )
    await expect(dialog.getByText('2,5 portsjonit')).toBeInTheDocument()
  },
}

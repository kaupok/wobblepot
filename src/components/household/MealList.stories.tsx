import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { householdMealList } from '@/stories/fixtures'
import { MealList } from './MealList'

const meta = {
  title: 'Feature/Household/MealList',
  component: MealList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Renders the user’s custom meals as a stack of cards. Each row exposes favorite, edit, and delete actions; deletion goes through a confirm dialog. Mutations call `/api/meals/:id/favorite` and `/api/households/me/meals/:id` (DELETE) — both backed by MSW in stories.',
      },
    },
  },
  args: {
    meals: householdMealList,
    onDelete: fn(),
    onToggleFavorite: fn(),
  },
} satisfies Meta<typeof MealList>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: { meals: [] },
  parameters: {
    docs: {
      description: {
        story: 'Empty state — verbiage encourages the user to create their first custom meal.',
      },
    },
  },
}

export const Populated: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Three-meal mix — poultry, fish (favorited), and vegetarian — for the visual baseline.',
      },
    },
  },
}

export const WithSearch: Story = {
  args: {
    meals: householdMealList.slice(0, 1),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Single meal — represents the post-search filter state where only one match remains.',
      },
    },
  },
}

// Play story — exercises the delete-confirmation contract end-to-end:
// click Delete → confirm dialog opens → click Delete again → MSW resolves the
// DELETE → onDelete callback fires with the meal id.

export const DeleteConfirmInvokesCallback: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const deleteButtons = await canvas.findAllByRole('button', { name: /delete meal/i })
    await userEvent.click(deleteButtons[0]!)

    const body = within(document.body)
    const dialog = await body.findByRole('alertdialog')
    const confirmButton = within(dialog).getByRole('button', { name: /^delete$/i })
    await userEvent.click(confirmButton)

    await waitFor(() => expect(args.onDelete).toHaveBeenCalledWith('household-meal-1'))
  },
}

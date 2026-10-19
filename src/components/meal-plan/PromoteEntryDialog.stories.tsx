import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { PromoteEntryDialog } from './PromoteEntryDialog'

const meta = {
  title: 'Meal plan/PromoteEntryDialog',
  component: PromoteEntryDialog,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Confirms "Make it my recipe" (HON-1245) and says what it does before the write: on a library meal, a new recipe in My recipes under a name the household can change; on the household’s own recipe, the recipe updated, with every planned meal of it.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    isCustom: false,
    mealName: 'Tuna pasta with garlic and chilli',
    isSubmitting: false,
    onSubmit: fn(async () => true),
  },
} satisfies Meta<typeof PromoteEntryDialog>

export default meta
type Story = StoryObj<typeof meta>

/** A library meal: the name starts as "(my version)" and saves trimmed. */
export const NewRecipe: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    // Found by its title; the open animation starts at opacity 0.
    await body.findByRole('dialog', { name: 'Make it my recipe' })
    const name = body.getByRole('textbox', { name: 'Recipe name' })
    await expect(name).toHaveValue('Tuna pasta with garlic and chilli (my version)')
    await userEvent.clear(name)
    await userEvent.type(name, ' Weeknight tuna pasta ')
    await userEvent.click(body.getByRole('button', { name: 'Save to My recipes' }))
    await waitFor(() => expect(args.onSubmit).toHaveBeenCalledWith('Weeknight tuna pasta'))
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
  },
}

/** The household's own recipe: no name to give, and the outcome is spelled out. */
export const UpdateRecipe: Story = {
  args: { isCustom: true, mealName: 'Tuna pasta (my version)' },
  play: async ({ args }) => {
    const body = within(document.body)
    const dialog = await body.findByRole('dialog', { name: 'Update the recipe' })
    await expect(dialog).toHaveTextContent('Every planned meal of this recipe changes too.')
    await expect(body.queryByRole('textbox')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Update the recipe' }))
    await waitFor(() => expect(args.onSubmit).toHaveBeenCalled())
  },
}

/** While the recipe is saved, the field and both buttons wait. */
export const Saving: Story = {
  args: { isSubmitting: true },
  play: async () => {
    const body = within(document.body)
    await body.findByRole('dialog', { name: 'Make it my recipe' })
    await expect(body.getByRole('textbox', { name: 'Recipe name' })).toBeDisabled()
    await expect(body.getByRole('button', { name: 'Save to My recipes' })).toBeDisabled()
    await expect(body.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  },
}

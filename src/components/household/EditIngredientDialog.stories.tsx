import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, within } from 'storybook/test'
import { EditIngredientDialog } from './EditIngredientDialog'
import { speltPasta } from './ingredient-fixtures'

const meta = {
  title: 'Feature/Household/EditIngredientDialog',
  component: EditIngredientDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Edit on the Ingredients tab (HON-1264): the fields of "Add as new ingredient" (`IngredientFields`), filled from the row. Save sends `PATCH /api/ingredients/:id`. A name the catalogue already has (409 `name_taken`) marks the name with catalog copy; a unit change on a used row (409 `unit_locked`) says why under the fields.',
      },
    },
  },
  args: {
    open: true,
    ingredient: speltPasta,
    onOpenChange: fn(),
  },
} satisfies Meta<typeof EditIngredientDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Filled: Story = {
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', {
      name: 'Edit ingredient: spelt pasta',
    })
    await expect(within(dialog).getByLabelText('Name')).toHaveValue('spelt pasta')
    await expect(within(dialog).getByRole('button', { name: 'Eggs' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}

export const NameTaken: Story = {
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/ingredients/:id', () =>
          HttpResponse.json({ error: 'taken', code: 'name_taken' }, { status: 409 }),
        ),
      ],
    },
  },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await expect(
      await within(dialog).findByText(
        'An ingredient with this name exists. Choose another name, or use that ingredient in your recipes.',
      ),
    ).toBeInTheDocument()
  },
}

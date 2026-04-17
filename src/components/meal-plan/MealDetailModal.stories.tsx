import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  createMeal,
  lemonGarlicChickenComponentsFull,
  lemonGarlicChickenPantryWithOil,
} from '@/stories/fixtures'
import { MealDetailModal } from './MealDetailModal'

const mealFixture = createMeal({ components: lemonGarlicChickenComponentsFull })

const meta = {
  title: 'Meal plan/MealDetailModal',
  component: MealDetailModal,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Wraps MealDetail in a Dialog — portal-based. Use the theme toolbar to verify dark mode styles the overlay + content correctly.',
      },
    },
  },
  args: {
    meal: mealFixture,
    householdSize: 4,
    open: true,
    onOpenChange: fn(),
    planId: 'plan-1',
    entryId: 'entry-1',
    pantryIngredients: lemonGarlicChickenPantryWithOil,
  },
} satisfies Meta<typeof MealDetailModal>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {}

export const WithNote: Story = {
  args: {
    note: 'Kids loved this — double the garlic next time.',
    onNoteChange: fn(),
  },
}

export const WithServingOverride: Story = {
  args: {
    servingOverride: 6,
    onServingOverrideChange: fn(),
  },
}

export const WithPreparationNotes: Story = {
  args: {
    meal: createMeal({
      components: lemonGarlicChickenComponentsFull,
      preparationNotes:
        'Broil last 2 minutes for crispier skin. Serve with steamed green beans and flaky salt.',
    }),
  },
}

// Play stories — exercise the component's parent-callback contract under
// @storybook/test-runner. Radix Dialog portals outside `canvasElement`, so we
// scope queries to `document.body` via `within(document.body)`.

export const EscapeClosesDialog: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    await body.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

export const ChangeServingInvokesCallback: Story = {
  args: {
    servingOverride: 6,
    onServingOverrideChange: fn(),
  },
  play: async ({ args }) => {
    const body = within(document.body)
    const servingButton = await body.findByRole('button', { name: /serves 6/i })
    await userEvent.click(servingButton)

    const input = await body.findByLabelText('Number of servings')
    await userEvent.clear(input)
    await userEvent.type(input, '5')
    await userEvent.keyboard('{Enter}')

    // handleServingsChange awaits the PATCH before firing onServingOverrideChange
    await waitFor(() => expect(args.onServingOverrideChange).toHaveBeenCalledWith(5))
  },
}

export const EditNoteInvokesCallback: Story = {
  args: {
    note: 'Kids loved this — double the garlic next time.',
    onNoteChange: fn(),
  },
  play: async ({ args }) => {
    const body = within(document.body)
    const editButton = await body.findByRole('button', { name: /kids loved this/i })
    await userEvent.click(editButton)

    const textarea = await body.findByLabelText('Meal note')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Add extra lemon zest.')
    await userEvent.keyboard('{Enter}')

    // NoteEditor.handleSave awaits the PATCH before firing onNoteChange
    await waitFor(() => expect(args.onNoteChange).toHaveBeenCalledWith('Add extra lemon zest.'))
  },
}

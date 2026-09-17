import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
  openViaTrigger,
  pressEscape,
} from '@/stories/a11y-helpers'
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
// @storybook/addon-vitest. Radix Dialog portals outside `canvasElement`, so we
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

// The serving count is an input to the cached preparation tips, so the PATCH
// nulls them server-side (HON-681). This component is rendered unconditionally
// by `MealCard`, so it never unmounts — without dropping the hook's `tips` on
// the same success branch, the panel keeps rendering the old count's pan sizes
// through a close and reopen, and `handleHowToPrepare` short-circuits on the
// stale object rather than re-fetching.
export const ChangeServingDropsCachedTips: Story = {
  args: {
    servingOverride: 6,
    onServingOverrideChange: fn(),
  },
  parameters: {
    // An array here replaces `defaultHandlers` wholesale, so the servings PATCH
    // has to be re-declared alongside the tips endpoint — without it the fetch
    // fails, the component rolls the count back, and nothing is asserted.
    msw: {
      handlers: [
        http.patch('/api/meal-plans/:planId/entries/:entryId', () =>
          HttpResponse.json({ ok: true }),
        ),
        http.post('/api/meal-plans/:planId/entries/:entryId/preparation-tips', () =>
          HttpResponse.json({
            tips: {
              equipment: ['A 28cm skillet for six portions'],
              steps: ['Sear the chicken in two batches'],
              pitfalls: ['Crowding the pan steams the skin'],
            },
          }),
        ),
      ],
    },
  },
  play: async () => {
    const body = within(document.body)

    // Generate tips for the stored count of 6.
    await userEvent.click(await body.findByRole('button', { name: /how to prepare/i }))
    await body.findByText(/28cm skillet/i)

    // Re-plan the same entry at 3 servings.
    await userEvent.click(await body.findByRole('button', { name: /serves 6/i }))
    const input = await body.findByLabelText('Number of servings')
    await userEvent.clear(input)
    await userEvent.type(input, '3')
    await userEvent.keyboard('{Enter}')

    // The six-portion tips are gone and the panel is back to its prompt, so
    // the next "How to prepare" re-POSTs instead of replaying the old object.
    await waitFor(() => expect(body.queryByText(/28cm skillet/i)).not.toBeInTheDocument())
    await body.findByRole('button', { name: /how to prepare/i })
  },
}

export const CompletedServingsReadOnly: Story = {
  args: {
    status: 'completed',
    servingOverride: 6,
    onServingOverrideChange: fn(),
  },
  parameters: {
    docs: {
      description: {
        story:
          'A completed entry’s servings are what the pantry was charged for, so the API refuses to change them (HON-652). The count renders as static header text, with no edit control.',
      },
    },
  },
  play: async () => {
    const body = within(document.body)
    const dialog = await body.findByRole('dialog')
    await expect(within(dialog).getByText('Ingredients (serves 6)')).toBeInTheDocument()
    await expect(within(dialog).queryByRole('button', { name: /serves 6/i })).toBeNull()
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

// Interaction-a11y story — asserts focus trap on open, tab containment, Escape
// handling, and close-sequence completion. See `src/stories/a11y-helpers.ts`.
// Wraps the modal in a local trigger-button render so it can be opened via
// keyboard like a real callsite.
export const A11yInteractionPatterns: Story = {
  args: { open: false },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div>
        <button type="button" data-testid="a11y-trigger" onClick={() => setOpen(true)}>
          Open modal
        </button>
        <MealDetailModal
          {...args}
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            args.onOpenChange?.(next)
          }}
        />
      </div>
    )
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByTestId('a11y-trigger')

    await openViaTrigger(trigger)
    await assertFocusInDialog()
    await assertTabStaysInDialog()

    await pressEscape()
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
    await awaitDialogClosed()
  },
}

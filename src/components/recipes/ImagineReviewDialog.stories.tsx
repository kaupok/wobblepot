import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
  openViaTrigger,
  pressEscape,
} from '@/stories/a11y-helpers'
import {
  createLowConfidencePrefilledIngredient,
  createMatchedPrefilledIngredient,
  createReviewMealData,
  createUnmatchedPrefilledIngredient,
} from '@/stories/fixtures'
import { ImagineReviewDialog } from './ImagineReviewDialog'

const meta = {
  title: 'Feature/Recipes/ImagineReviewDialog',
  component: ImagineReviewDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Review step of the "Imagine a meal" flow. The dialog renders through a Radix portal, so play-function queries go through `within(document.body)`. Saving posts to `/api/households/me/meals`; default MSW handlers return `{ id: "new-meal-123" }`.',
      },
    },
  },
  args: {
    open: true,
    meal: createReviewMealData(),
    onOpenChange: fn(),
    onSaved: fn(),
    onEditDetails: fn(),
  },
} satisfies Meta<typeof ImagineReviewDialog>

export default meta
type Story = StoryObj<typeof meta>

// Prop-driven stories — exercise the component's render surface.

export const AllMatched: Story = {}

export const WithUnmatchedIngredients: Story = {
  args: {
    meal: createReviewMealData({
      prefilledIngredients: [
        createMatchedPrefilledIngredient({ convertedQuantity: 600 }),
        createUnmatchedPrefilledIngredient(),
        createMatchedPrefilledIngredient({ convertedQuantity: 300 }),
      ],
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'One row the extractor could not match. The "Save meal" button is disabled until the user resolves it.',
      },
    },
  },
}

export const WithLowConfidenceIngredients: Story = {
  args: {
    meal: createReviewMealData({
      prefilledIngredients: [
        createMatchedPrefilledIngredient({ convertedQuantity: 600 }),
        createLowConfidencePrefilledIngredient(),
        createMatchedPrefilledIngredient({ convertedQuantity: 300 }),
      ],
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Ambiguous (low-confidence) match surfaces the "to verify" bucket with alternative suggestions the user can accept.',
      },
    },
  },
}

export const LongDescription: Story = {
  args: {
    meal: createReviewMealData({
      description:
        'Pan-seared salmon glazed with a sweet-savoury miso mixture, broiled until caramelised, served over short-grain rice with quick-pickled cucumber ribbons and a sprinkle of toasted sesame. The glaze comes together in minutes and keeps for weeks in the fridge, so you can make a double batch and save half for the next round.',
      preparationNotes:
        'Pat the salmon dry before glazing to help the miso adhere. Broil on the top rack for the last two minutes to get a proper lacquer without overcooking the flesh. Serve with pickled cucumbers prepared at least 30 minutes ahead for best flavour.',
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Long description + preparation notes — verifies the dialog content area scrolls instead of overflowing.',
      },
    },
  },
}

export const WithoutEditDetails: Story = {
  args: {
    onEditDetails: undefined,
  },
  parameters: {
    docs: {
      description: {
        story:
          '`onEditDetails` omitted — the "Edit details" escape-hatch button should not render.',
      },
    },
  },
}

// Locale-toggle story — macros use `formatInteger` (non-breaking-space grouping
// in et, comma in en) and matched per-serving rows use `formatQuantity` (comma
// vs period decimal). Defaults already produce a 4-figure calorie value for et
// grouping to be visible.
export const EstonianLocale: Story = {
  args: {
    meal: createReviewMealData({
      nutrition: { calories: 1234, protein: 56, carbs: 78, fat: 12 },
      servings: 400,
      prefilledIngredients: [createMatchedPrefilledIngredient({ convertedQuantity: 600 })],
    }),
  },
  globals: { locale: 'et' },
  parameters: {
    docs: {
      description: {
        story:
          'Estonian locale — macros use a non-breaking-space thousands grouping (`1 234 kcal`) and the matched per-serving row uses a comma decimal (`1,5g`).',
      },
    },
  },
}

// Play stories — exercise parent-callback contracts under @storybook/addon-vitest.
// Radix Dialog content lives outside `canvasElement`, so queries use `within(document.body)`.

export const EscapeClosesDialog: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    await body.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

export const SaveInvokesCallback: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    const saveButton = await body.findByRole('button', { name: /^save meal$/i })
    await userEvent.click(saveButton)
    // handleSave awaits the POST before firing onSaved
    await waitFor(() => expect(args.onSaved).toHaveBeenCalledWith('new-meal-123'))
  },
}

export const EditDetailsInvokesCallback: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    const link = await body.findByRole('button', { name: /^edit details$/i })
    await userEvent.click(link)
    await expect(args.onEditDetails).toHaveBeenCalledWith(expect.any(Array))
  },
}

export const SaveDisabledWhenUnresolved: Story = {
  args: {
    meal: createReviewMealData({
      prefilledIngredients: [
        createMatchedPrefilledIngredient({ convertedQuantity: 600 }),
        createUnmatchedPrefilledIngredient(),
      ],
    }),
  },
  play: async ({ args }) => {
    const body = within(document.body)
    const saveButton = await body.findByRole('button', { name: /^save meal$/i })
    await expect(saveButton).toBeDisabled()
    await expect(args.onSaved).not.toHaveBeenCalled()
  },
}

// Interaction-a11y story — focus trap / tab containment / Escape / close-
// sequence completion. See `src/stories/a11y-helpers.ts`.
export const A11yInteractionPatterns: Story = {
  args: { open: false },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div>
        <button type="button" data-testid="a11y-trigger" onClick={() => setOpen(true)}>
          Open modal
        </button>
        <ImagineReviewDialog
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

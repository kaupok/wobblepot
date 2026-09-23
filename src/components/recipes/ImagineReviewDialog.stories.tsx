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
  createLowConfidencePrefilledIngredient,
  createMatchedPrefilledIngredient,
  createReviewMealData,
  createUnmatchedPrefilledIngredient,
  reviewIngredient,
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

// Locale-toggle story — macros use `formatInteger` (comma grouping in en; CLDR
// Estonian only groups from 5 digits) and matched per-serving rows use
// `formatQuantity` (comma vs period decimal). One serving of 400g rice gives a
// 4-figure calorie value; 1.5g of salmon makes the comma decimal visible.
export const EstonianLocale: Story = {
  args: {
    meal: createReviewMealData({
      servings: 1,
      prefilledIngredients: [
        createMatchedPrefilledIngredient({ convertedQuantity: 1.5 }),
        createMatchedPrefilledIngredient({
          ingredient: reviewIngredient('short-grain-rice'),
          convertedQuantity: 400,
        }),
      ],
    }),
  },
  globals: { locale: 'et' },
  parameters: {
    docs: {
      description: {
        story:
          'Estonian locale — a 4-figure calorie value renders ungrouped (`1435 kcal`, not the en `1,435`) and the matched per-serving row uses a comma decimal (`1,5g`).',
      },
    },
  },
}

// Macro line — derived from the live rows, never from the imagine response
// (HON-721). Salmon 600g + rice 280g + miso 30g over 4 servings at the fixture
// macros: 312 + 250.6 + 14.85 = 577 kcal; dropping the miso leaves 563.
export const MacrosFollowRowRemoval: Story = {
  args: {
    meal: createReviewMealData({
      prefilledIngredients: [
        createMatchedPrefilledIngredient({ convertedQuantity: 600 }),
        createMatchedPrefilledIngredient({
          ingredient: reviewIngredient('short-grain-rice'),
          convertedQuantity: 280,
        }),
        createLowConfidencePrefilledIngredient(),
      ],
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'The macro line is summed from the rows as they stand, through the same reducer the save endpoint uses, so removing or editing a row updates it and it always matches the meal that gets stored.',
      },
    },
  },
  play: async () => {
    const body = within(document.body)
    await body.findByText(/^577 kcal/)
    await userEvent.click(body.getByRole('button', { name: /^remove ingredient$/i }))
    await body.findByText(/^563 kcal/)
  },
}

export const MacrosHiddenWithoutMacroData: Story = {
  args: {
    meal: createReviewMealData({
      prefilledIngredients: [
        createMatchedPrefilledIngredient({ convertedQuantity: 600 }),
        createMatchedPrefilledIngredient({
          ingredient: {
            id: 'white-miso-hikari',
            name: 'White miso (Hikari)',
            category: 'condiment',
            defaultUnit: 'g',
          },
          convertedQuantity: 30,
        }),
      ],
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'One row has no macro data — as when the user picks a low-confidence alternative, which carries none. The line is hidden rather than showing a partial total or zeros.',
      },
    },
  },
  play: async () => {
    const body = within(document.body)
    await body.findByRole('dialog')
    await expect(body.queryByText(/kcal/)).not.toBeInTheDocument()
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

export const SaveFailedEstonian: Story = {
  globals: { locale: 'et' },
  parameters: {
    msw: {
      handlers: [
        http.post('/api/households/me/meals', () =>
          HttpResponse.json({ error: 'Failed to create meal' }, { status: 500 }),
        ),
      ],
    },
    docs: {
      description: {
        story:
          "The save POST fails. The dialog renders its own translated error, never the route's English `error` prose (HON-724).",
      },
    },
  },
  play: async ({ args }) => {
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: /^salvesta toit$/i }))
    await body.findByText('Toidu salvestamine ebaõnnestus')
    await expect(body.queryByText('Failed to create meal')).not.toBeInTheDocument()
    await expect(args.onSaved).not.toHaveBeenCalled()
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

    // The disabled state states its reason, wired to the button for screen readers.
    const reason = body.getByText('Match or drop 1 ingredient to save')
    await expect(saveButton).toHaveAttribute('aria-describedby', reason.id)
    await expect(saveButton).toHaveAccessibleDescription('Match or drop 1 ingredient to save')

    // Dropping the last unresolved row enables Save and removes the reason.
    await userEvent.click(body.getByRole('button', { name: /^drop$/i }))
    await waitFor(() => expect(saveButton).toBeEnabled())
    await expect(body.queryByText(/to save$/)).not.toBeInTheDocument()
    await expect(saveButton).not.toHaveAttribute('aria-describedby')
  },
}

// Storybook defaults to a mobile viewport, where the footer is a column anyway.
// From `sm` up, `DialogFooter`'s `sm:flex-row` once put the full-width Save beside
// "Edit details" and pushed it out through the dialog's left padding (HON-759).
export const DesktopWithUnresolvedIngredients: Story = {
  args: {
    meal: createReviewMealData({
      prefilledIngredients: [
        createMatchedPrefilledIngredient({ convertedQuantity: 600 }),
        createUnmatchedPrefilledIngredient(),
        createUnmatchedPrefilledIngredient({ extractedName: 'yuzu', originalText: '1 yuzu' }),
        createLowConfidencePrefilledIngredient(),
      ],
    }),
  },
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  parameters: {
    docs: {
      description: {
        story:
          'Desktop width with unmatched and low-confidence rows. Save spans the footer inside the dialog padding, the reason line sits below it, and "Edit details" is centred beneath on one line.',
      },
    },
  },
  play: async () => {
    const body = within(document.body)
    const dialog = await body.findByRole('dialog')
    const saveButton = await body.findByRole('button', { name: /^save meal$/i })
    await expect(saveButton).toHaveAccessibleDescription(
      'Match or drop 2 ingredients and confirm 1 to save',
    )

    // The open animation scales the dialog; measure its settled geometry.
    await Promise.all(dialog.getAnimations().map((animation) => animation.finished))
    await expect(dialog.scrollWidth).toBe(dialog.clientWidth)

    const style = getComputedStyle(dialog)
    const box = dialog.getBoundingClientRect()
    const contentLeft = box.left + dialog.clientLeft + parseFloat(style.paddingLeft)
    const contentRight =
      box.left + dialog.clientLeft + dialog.clientWidth - parseFloat(style.paddingRight)
    const save = saveButton.getBoundingClientRect()
    await expect(save.left).toBeGreaterThanOrEqual(contentLeft - 0.5)
    await expect(save.right).toBeLessThanOrEqual(contentRight + 0.5)

    // "Edit details" sits below Save, on a single line.
    const editDetails = body.getByRole('button', { name: /^edit details$/i })
    const edit = editDetails.getBoundingClientRect()
    await expect(edit.top).toBeGreaterThanOrEqual(save.bottom)
    await expect(edit.height).toBeLessThan(
      parseFloat(getComputedStyle(editDetails).lineHeight) * 1.5,
    )
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

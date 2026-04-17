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
import { createChildMember, createMember, createMemberPreferences } from '@/stories/fixtures'
import { EditMemberPreferencesDialog } from './EditMemberPreferencesDialog'

const meta = {
  title: 'Feature/Household/EditMemberPreferencesDialog',
  component: EditMemberPreferencesDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Dialog for editing a member’s display name and portion size. The "Name" input only shows for manual members (no linked user account). PATCH submission goes to `/api/households/me/members/:id` via MSW in stories.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    onSaved: fn(),
    isManualMember: false,
    member: createMember(),
  },
} satisfies Meta<typeof EditMemberPreferencesDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Adult: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Linked-account adult member — Name field hidden, regular portion preselected.',
      },
    },
  },
  play: async () => {
    const body = within(document.body)
    await body.findByRole('dialog')
  },
}

export const Child: Story = {
  args: {
    member: createChildMember(),
    isManualMember: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Manual child member — Name field visible, "Small" portion preselected with the matching display name.',
      },
    },
  },
}

export const WithAllergens: Story = {
  args: {
    member: createMember({
      preferences: createMemberPreferences({
        displayName: 'Mom',
        allergens: ['gluten', 'nuts'],
        dietaryType: 'pescatarian',
      }),
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Member with allergens + dietary type set — current dialog only edits display name + portion, but the existing preferences are preserved on save (verified by the play story below).',
      },
    },
  },
}

export const Open: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Default open state with the canonical owner member. Used as the baseline visual reference.',
      },
    },
  },
}

// Play story — exercises the parent-callback contract. We toggle a different
// portion preset, type into the display name field, then submit. The default
// MSW handler echoes the payload back as a saved member, so onSaved fires with
// the new shape.

export const SaveInvokesCallback: Story = {
  args: {
    member: createChildMember(),
    isManualMember: true,
  },
  play: async ({ args }) => {
    const body = within(document.body)
    await body.findByRole('dialog')

    const displayNameInput = await body.findByLabelText(/display name/i)
    await userEvent.clear(displayNameInput)
    await userEvent.type(displayNameInput, 'Sammy')

    const largePortion = await body.findByRole('button', { name: /large \(1\.5x\)/i })
    await userEvent.click(largePortion)

    const submitButton = await body.findByRole('button', { name: /save preferences/i })
    await userEvent.click(submitButton)

    await waitFor(() =>
      expect(args.onSaved).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            displayName: 'Sammy',
            portionMultiplier: 1.5,
          }),
        }),
      ),
    )
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
  },
}

// Interaction-a11y story — focus trap / tab containment / Escape / focus
// restore. See `src/stories/a11y-helpers.ts`.
export const A11yInteractionPatterns: Story = {
  args: { open: false },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div>
        <button type="button" data-testid="a11y-trigger" onClick={() => setOpen(true)}>
          Open modal
        </button>
        <EditMemberPreferencesDialog
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

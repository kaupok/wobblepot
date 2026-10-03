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
          'Dialog for editing how a member appears and their portion size. A manual member (no linked account) has one "Name" field; an account member has "Display name (optional)" instead, because their account name is fixed (HON-1021). PATCH submission goes to `/api/households/me/members/:id` via MSW in stories.',
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
        story:
          'Account member — Display name shown, no Name field, regular portion preselected and the custom input hidden. The display name is optional: the account name stands in for it.',
      },
    },
  },
  play: async () => {
    const body = within(document.body)
    await body.findByRole('dialog')
    await expect(body.getByLabelText('Display name (optional)')).not.toBeRequired()
    await expect(body.queryByLabelText('Name')).toBeNull()
    await expect(body.getByText(/change how this member appears/i)).toBeInTheDocument()
    await expect(body.queryByRole('textbox', { name: /portion multiplier/i })).toBeNull()
    // The presets are a named radiogroup with the matching preset checked (HON-828).
    const presets = await body.findByRole('radiogroup', { name: /portion size/i })
    const checked = within(presets)
      .getAllByRole('radio')
      .filter((radio) => radio.getAttribute('aria-checked') === 'true')
    await expect(checked).toHaveLength(1)
    await expect(checked[0]).toHaveAccessibleName(/regular \(1×\)/i)
  },
}

export const CustomPortion: Story = {
  args: {
    member: createMember({
      preferences: createMemberPreferences({ portionMultiplier: 1.25 }),
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'A portion multiplier that matches no preset (1.25×): Custom is checked and the input shows the value.',
      },
    },
  },
  play: async () => {
    const body = within(document.body)
    const presets = await body.findByRole('radiogroup', { name: /portion size/i })
    await expect(within(presets).getByRole('radio', { name: /custom/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(body.getByRole('textbox', { name: /portion multiplier/i })).toHaveValue('1.25')
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
          'Manual child member — one Name field, prefilled with the old display name ("kiddo") so saving folds it into the name (HON-1021). "Small" portion preselected.',
      },
    },
  },
  play: async () => {
    const body = within(document.body)
    await body.findByRole('dialog')
    await expect(body.queryByLabelText(/display name/i)).toBeNull()
    const nameInput = body.getByLabelText('Name')
    await expect(nameInput).toHaveValue('kiddo')
    await expect(nameInput).toHaveAttribute('placeholder', 'e.g., Mia')
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
          'Member with allergens + dietary type set — the dialog only edits display name + portion; the other preferences are left out of the PATCH, so the route keeps them.',
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

// Play stories — exercise the parent-callback contract. The default MSW handler
// echoes the payload back as a saved member, so onSaved fires with the new shape.

// Manual member: the typed name goes out as `name` and the display name is
// cleared, so the row shows the one name.

export const SaveInvokesCallback: Story = {
  args: {
    member: createChildMember(),
    isManualMember: true,
  },
  play: async ({ args }) => {
    const body = within(document.body)
    await body.findByRole('dialog')

    const nameInput = await body.findByLabelText('Name')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Sammy')

    const largePortion = await body.findByRole('radio', { name: /^large \(1\.5×\)/i })
    await userEvent.click(largePortion)
    await expect(largePortion).toHaveAttribute('aria-checked', 'true')

    const submitButton = await body.findByRole('button', { name: /save preferences/i })
    await userEvent.click(submitButton)

    await waitFor(() =>
      expect(args.onSaved).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Sammy',
          preferences: expect.objectContaining({
            displayName: null,
            portionMultiplier: 1.5,
          }),
        }),
      ),
    )
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
  },
}

// Account member: the display name saves as before, and no name is sent.
export const SaveAccountMemberInvokesCallback: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    await body.findByRole('dialog')

    const displayNameInput = await body.findByLabelText('Display name (optional)')
    await userEvent.clear(displayNameInput)
    await userEvent.type(displayNameInput, 'Mom')
    await userEvent.click(body.getByRole('radio', { name: /custom/i }))
    const portionInput = body.getByRole('textbox', { name: /portion multiplier/i })
    await userEvent.clear(portionInput)
    await userEvent.type(portionInput, '1.25')

    await userEvent.click(body.getByRole('button', { name: /save preferences/i }))

    await waitFor(() =>
      expect(args.onSaved).toHaveBeenCalledWith(
        expect.objectContaining({
          // The MSW handler falls back to 'Member' when no name is sent.
          name: 'Member',
          preferences: expect.objectContaining({ displayName: 'Mom', portionMultiplier: 1.25 }),
        }),
      ),
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

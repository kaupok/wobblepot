import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { HouseholdDetailsForm } from './HouseholdDetailsForm'

const meta = {
  title: 'Feature/Household/HouseholdDetailsForm',
  component: HouseholdDetailsForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Household → Settings (HON-1257): the Household details section, a Section-level h2 and its own form (HON-960, HON-961): name, timezone and language. The Save button shows only while a field differs from the saved value. The locale selector exposes every locale in `PUBLIC_LOCALES` — currently English and Estonian.',
      },
    },
  },
  args: {
    household: {
      id: 'household-default',
      name: 'Test household',
      timezone: 'Europe/Tallinn',
      locale: 'en',
    },
    isOwner: true,
  },
} satisfies Meta<typeof HouseholdDetailsForm>

export default meta
type Story = StoryObj<typeof meta>

// The body of the last PATCH the route received, for the payload assertion.
let lastHouseholdBody: unknown

// The submit button in either state. While the save is in flight it reads
// "Saving…", so waiting only for "Save" to go passes mid-request (HON-1140).
const SAVE_BUTTON = /^(Save|Saving…)$/

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Standard household on the default English locale. The play function checks that both select triggers carry their value text from the first render, not only after Radix mounts the options (HON-761).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // At rest there is nothing to save (HON-961).
    await expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    // No waitFor: the value text must be there synchronously (HON-761).
    await expect(canvas.getByRole('combobox', { name: /timezone/i })).toHaveTextContent(
      'Europe/Tallinn',
    )
    await expect(canvas.getByRole('combobox', { name: 'Language' })).toHaveTextContent('English')
  },
}

export const EstonianHousehold: Story = {
  args: {
    household: {
      id: 'household-et',
      name: 'Partner household',
      timezone: 'Europe/Tallinn',
      locale: 'et',
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          'Household whose persisted `locale` is Estonian — selector trigger reflects the current value and both options remain selectable.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('combobox', { name: 'Language' })).toHaveTextContent('Estonian')
  },
}

export const NonOwner: Story = {
  args: { isOwner: false },
  parameters: {
    docs: {
      description: {
        story:
          "Non-owner viewer: every control is disabled and there is no save button. The route is owner-only (HON-677); the owner-only notice is the Settings page's, above this form (HON-960).",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Household name')).toBeDisabled()
    await expect(canvas.getByRole('combobox', { name: /timezone/i })).toBeDisabled()
    await expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  },
}

export const Dirty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/households/me', async ({ request }) => {
          lastHouseholdBody = await request.json()
          return HttpResponse.json({})
        }),
      ],
    },
    docs: {
      description: {
        story:
          'A changed household name: the section shows its Save button. Saving sends only the household fields, then the button goes.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    lastHouseholdBody = undefined
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Household name'), ' and friends')
    const save = canvas.getByRole('button', { name: 'Save' })
    await expect(save).toBeVisible()

    await userEvent.click(save)
    await waitFor(() =>
      expect(lastHouseholdBody).toEqual({
        name: 'Test household and friends',
        timezone: 'Europe/Tallinn',
        locale: 'en',
      }),
    )
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: SAVE_BUTTON })).not.toBeInTheDocument(),
    )
  },
}

export const TimezonePicked: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Another timezone picked from the open menu. Only the selected timezone mounts until the trigger is first focused or pressed, so the play function checks that a press still opens the full list (HON-1180).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('combobox', { name: /timezone/i })
    await userEvent.click(trigger)
    // Radix portals the menu to the body.
    const option = await within(document.body).findByRole('option', { name: 'America/New York' })
    await userEvent.click(option)
    await expect(trigger).toHaveTextContent('America/New York')
    // The page stays aria-hidden until the menu's close animation ends.
    await expect(await canvas.findByRole('button', { name: 'Save' })).toBeVisible()
  },
}

export const Desktop: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'Desktop width with a changed name. "Save" is as wide as its label and starts at the column edge; on a phone it fills the column (HON-782).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Household name'), '!')
    const button = canvas.getByRole('button', { name: 'Save' })
    await expect(button.getBoundingClientRect().width).toBeLessThan(
      button.parentElement!.getBoundingClientRect().width,
    )
  },
}

export const Phone: Story = {
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story: 'Phone width with a changed name: "Save" fills the column (HON-782).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Household name'), '!')
    const button = canvas.getByRole('button', { name: 'Save' })
    await expect(button.getBoundingClientRect().width).toBe(
      button.parentElement!.getBoundingClientRect().width,
    )
    const form = canvas.getByRole('form', { name: 'Household details' })
    await expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth)
  },
}

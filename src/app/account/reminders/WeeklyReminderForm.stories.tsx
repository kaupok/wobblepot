import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { WeeklyReminderForm } from './WeeklyReminderForm'

const meta = {
  title: 'Feature/Account/WeeklyReminderForm',
  component: WeeklyReminderForm,
  tags: ['autodocs'],
  args: { weekday: null, confirmed: true },
  parameters: {
    docs: {
      description: {
        component:
          "My account → Reminders (HON-1256): the viewer's own opt-in to one email on a weekday, sent only when next week has no meals planned (HON-1084). Every account holder can save it, owner or member, so it has no owner-only state. The first switch-on emails a confirm link, and the cron sends nothing until it is opened (HON-1113).",
      },
    },
  },
} satisfies Meta<typeof WeeklyReminderForm>

export default meta
type Story = StoryObj<typeof meta>

// The body of the last PATCH the reminder route received.
let lastReminderBody: unknown

// The submit button, in either state. While the save is in flight it reads
// "Saving…", so waiting only for "Save" to go passes mid-request (HON-1140).
const SAVE_BUTTON = /^(Save|Saving…)$/

export const Off: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The Weekly reminder section, switched off: one checkbox and the line that says what the email does. The weekday select shows only while it is on (HON-1084).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('checkbox', { name: 'Remind me to plan next week' })
    await expect(toggle).not.toBeChecked()
    await expect(toggle).toHaveAccessibleDescription(/only when next week has no meals planned/)
    await expect(canvas.queryByRole('combobox')).not.toBeInTheDocument()
  },
}

export const On: Story = {
  args: { weekday: 3 },
  parameters: {
    docs: {
      description: {
        story:
          'Switched on for Wednesday. The weekday names come from `Intl` in the household language, not the catalog.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('checkbox', { name: 'Remind me to plan next week' }),
    ).toBeChecked()
    await expect(canvas.getByRole('combobox', { name: 'Day' })).toHaveTextContent('Wednesday')
    await expect(canvas.queryByText(/We emailed you a link/)).not.toBeInTheDocument()
  },
}

export const AwaitingConfirm: Story = {
  args: { weekday: 7, confirmed: false },
  parameters: {
    docs: {
      description: {
        story:
          'Switched on, but the confirm link in the email is not opened yet: a muted line under the helper says the reminder starts after it is opened, and the checkbox carries it in its description (HON-1113).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const line = 'We emailed you a link. The reminder starts after you open it and confirm.'
    await expect(canvas.getByText(line)).toBeVisible()
    await expect(
      canvas.getByRole('checkbox', { name: 'Remind me to plan next week' }),
    ).toHaveAccessibleDescription(/We emailed you a link/)
  },
}

export const SwitchOn: Story = {
  ...Off,
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/households/me/members/me/reminder', async ({ request }) => {
          lastReminderBody = await request.json()
          return HttpResponse.json({})
        }),
      ],
    },
    docs: {
      description: {
        story:
          'Ticking the checkbox picks Sunday and shows the Save button. Saving sends `{ weekday: 7 }` to the member route, and focus moves to the section heading.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    lastReminderBody = undefined
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Remind me to plan next week' }))
    await expect(canvas.getByRole('combobox', { name: 'Day' })).toHaveTextContent('Sunday')

    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(lastReminderBody).toEqual({ weekday: 7 }))
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: SAVE_BUTTON })).not.toBeInTheDocument(),
    )
    await expect(canvas.getByRole('heading', { name: 'Weekly reminder' })).toHaveFocus()
  },
}

export const ConfirmNotSent: Story = {
  ...Off,
  args: { confirmed: false },
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/households/me/members/me/reminder', () =>
          HttpResponse.json({ weekday: 7, confirmEmail: 'not_sent' }),
        ),
      ],
    },
    docs: {
      description: {
        story:
          'The switch-on saved, but the route reports that the confirm email did not go out (rate limited or failed), so the line says the link was not sent and how to get it, instead of "We emailed you a link" (HON-1113).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Remind me to plan next week' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(await canvas.findByText(/We could not send you the link just now/)).toBeVisible()
    await expect(canvas.queryByText(/We emailed you a link/)).not.toBeInTheDocument()
  },
}

/** Estonian at phone width: the weekday names come from `Intl` in Estonian. */
export const PhoneEstonian: Story = {
  args: { weekday: 7 },
  globals: { viewport: { value: 'mobileIphone', isRotated: false }, locale: 'et' },
  render: (args) => (
    <div className="px-4">
      <WeeklyReminderForm {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('combobox', { name: 'Päev' })).toHaveTextContent('Pühapäev')
    const form = canvas.getByRole('form')
    await expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth)
  },
}

export const PausedAfterEmailChange: Story = {
  args: { weekday: 7, confirmed: false, confirmLinkSent: false },
  parameters: {
    docs: {
      description: {
        story:
          'On, but the account email changed, which cleared the confirmation and sent no new link (HON-1137): the line asks the member to switch the reminder off and on to get a link at the new address.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(/Your email address changed, so the reminder is paused/),
    ).toBeInTheDocument()
    await expect(canvas.queryByText(/We emailed you a link/)).not.toBeInTheDocument()
  },
}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { ProfileNameForm } from './ProfileNameForm'

// `authClient.updateUser()` posts to `/api/auth/update-user` on the absolute
// `getClientBaseURL()` origin, not the Storybook origin, so the handler
// matches any origin.
const UPDATE_USER = '*/api/auth/update-user'

const meta = {
  title: 'Feature/Profile/ProfileNameForm',
  component: ProfileNameForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Edits the account name on `/profile` (HON-1129). The name is trimmed and must be 1 to 100 characters; an empty name shows catalog copy and makes no request. A failed save shows catalog copy, never the server string, and returns focus to Save.',
      },
    },
    msw: {
      handlers: [http.post(UPDATE_USER, () => HttpResponse.json({ status: true }))],
    },
  },
  args: {
    initialName: 'Mari Maasikas',
  },
} satisfies Meta<typeof ProfileNameForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Name')).toHaveValue('Mari Maasikas')
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled()
  },
}

export const EmptyName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.clear(canvas.getByLabelText('Name'))
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(canvas.getByRole('alert')).toHaveTextContent('Enter your name.')
    await expect(canvas.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
  },
}

export const Pending: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(UPDATE_USER, async () => {
          await delay('infinite')
          return HttpResponse.json({ status: true })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Saving…' })).toBeDisabled())
    await expect(canvas.getByLabelText('Name')).toBeDisabled()
  },
}

export const SaveFailed: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(UPDATE_USER, () =>
          HttpResponse.json({ message: 'Internal server error' }, { status: 500 }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent('Your name was not saved. Try again.'),
    )
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Save' })).toHaveFocus())
  },
}

import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SettingsSection } from './SettingsSection'

/**
 * A one-field section, so each story shows the section's own states. Its
 * real callers are the household sections and My account → Reminders, whose
 * stories cover their fields.
 */
function NameSection({ isOwner, ownerOnly }: { isOwner: boolean; ownerOnly: boolean }) {
  const [saved, setSaved] = useState({ name: 'Test household' })
  const [name, setName] = useState(saved.name)
  const access = ownerOnly ? { isOwner } : { ownerOnly: false as const }

  return (
    <SettingsSection
      id="demo"
      heading="Household details"
      url="/api/demo-settings"
      {...access}
      values={{ name }}
      saved={saved}
      onSaved={setSaved}
    >
      {({ disabled, errorId }) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="demo-name">Household name</Label>
          <Input
            id="demo-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            aria-invalid={!!errorId}
            aria-describedby={errorId}
          />
        </div>
      )}
    </SettingsSection>
  )
}

const meta = {
  title: 'Components/SettingsSection',
  component: NameSection,
  tags: ['autodocs'],
  args: { isOwner: true, ownerOnly: true },
  parameters: {
    msw: {
      handlers: [http.patch('/api/demo-settings', () => HttpResponse.json({}))],
    },
    docs: {
      description: {
        component:
          "One settings section: its own form, Section-level h2, error and Save button (HON-961, shared in HON-1256). Save shows only while the section differs from its saved values or its save is in flight. A household section is the owner's, so a member sees it disabled; a section for the viewer's own setting (the weekly reminder) passes `ownerOnly: false`, so every account holder can save it.",
      },
    },
  },
} satisfies Meta<typeof NameSection>

export default meta
type Story = StoryObj<typeof meta>

export const AtRest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Household details', level: 2 })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  },
}

export const ChangedThenSaved: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Household name'), '!')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: /^(Save|Saving…)$/ })).not.toBeInTheDocument(),
    )
    // The button unmounted, so focus moves to the heading, not to <body>.
    await expect(canvas.getByRole('heading', { name: 'Household details' })).toHaveFocus()
  },
}

export const MemberOnOwnerSection: Story = {
  args: { isOwner: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Household name')).toBeDisabled()
  },
}

export const ViewersOwnSetting: Story = {
  args: { isOwner: false, ownerOnly: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Household name'), '!')
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled()
  },
}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'
import { NoteEditor } from './NoteEditor'

const meta = {
  title: 'Meal plan/NoteEditor',
  component: NoteEditor,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    planId: 'plan-1',
    entryId: 'entry-1',
    onNoteChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NoteEditor>

export default meta
type Story = StoryObj<typeof meta>

/** Every button in the story clears the 32px `sm` / `icon-sm` floor (HON-688). */
async function expectButtonsAtFloor(canvasElement: HTMLElement) {
  const buttons = within(canvasElement).getAllByRole('button')
  await expect(buttons.length).toBeGreaterThan(0)
  for (const button of buttons) {
    await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(32)
  }
}

export const Empty: Story = {
  args: { note: null },
}

export const WithNote: Story = {
  args: { note: 'Serve with steamed broccoli. The kids loved this one.' },
}

export const LongNote: Story = {
  args: {
    note: 'We usually double the garlic and swap lemon for lime. Took about an hour last time because the thighs were huge — worth pulling earlier next time.',
  },
}

export const Compact: Story = {
  args: {
    note: 'Kid-approved.',
    compact: true,
  },
  // The note is a wrapping text button, so its floor comes from `min-h-8`
  // rather than a `Button` size — a one-line note is where that shows.
  play: async ({ canvasElement }) => expectButtonsAtFloor(canvasElement),
}

export const CompactEmpty: Story = {
  args: {
    note: null,
    compact: true,
  },
  play: async ({ canvasElement }) => expectButtonsAtFloor(canvasElement),
}

export const Editing: Story = {
  args: {
    note: 'Click save or press Enter',
    isEditing: true,
    onEditingChange: fn(),
  },
  play: async ({ canvasElement }) => expectButtonsAtFloor(canvasElement),
}

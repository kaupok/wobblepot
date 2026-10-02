import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
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

/** A saved note is a tilted, taped slip, and the slip is the button that opens the editor. */
export const Display: Story = {
  args: { note: 'Eating out tonight.' },
  play: async ({ canvasElement }) => {
    const slip = within(canvasElement).getByRole('button', { name: 'Eating out tonight.' })
    await expect(slip).toHaveAttribute('data-surface', 'sticky')
    await expect(slip).toHaveAttribute('data-variant', 'interactive')
    await userEvent.click(slip)
    const textarea = await within(canvasElement).findByRole('textbox', { name: 'Meal note' })
    await waitFor(() => expect(textarea).toHaveFocus())
    // Same slip, now the editor's.
    await expect(textarea.closest('[data-surface="sticky"]')).toHaveAttribute(
      'data-variant',
      'editing',
    )
  },
}

/**
 * `clamped`: the slip laid over a planner card shows two lines at most, so
 * it fits the card (HON-974). Its name is still the whole note, and the editor
 * opens on all of it.
 */
export const DisplayClamped: Story = {
  args: {
    note: 'We usually double the garlic and swap lemon for lime. Took about an hour last time because the thighs were huge — worth pulling earlier next time.',
    clamped: true,
  },
  decorators: [
    (Story) => (
      <div className="w-48">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement, args }) => {
    await document.fonts.ready
    const slip = within(canvasElement).getByRole('button', { name: args.note! })
    const text = slip.querySelector('p')!
    // The note runs past two lines in this width, so the clamp hides the
    // rest: the clamp box overflows and is shorter than three lines.
    const clamp = text.parentElement!
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight)
    await expect(clamp.scrollHeight).toBeGreaterThan(clamp.clientHeight)
    await expect(clamp.clientHeight).toBeLessThan(lineHeight * 2.5)
    await userEvent.click(slip)
    const textarea = await within(canvasElement).findByRole('textbox', { name: 'Meal note' })
    await expect(textarea).toHaveValue(args.note)
  },
}

export const DisplayDark: Story = {
  ...Display,
  name: 'Display (dark)',
  globals: { theme: 'dark' },
}

/** Controlled editing, with a spy of its own per story. */
const editing = () => ({ isEditing: true, onEditingChange: fn() })

/** Editing a short note: no counter, Cancel and Save inside the slip, and Escape cancels. */
export const Editing: Story = {
  args: { note: 'Click save or press Enter', ...editing() },
  play: async ({ canvasElement, args }) => {
    await expectButtonsAtFloor(canvasElement)
    const canvas = within(canvasElement)
    const textarea = canvas.getByRole('textbox', { name: 'Meal note' })
    const slip = textarea.closest('[data-surface="sticky"]')!
    await expect(slip).toContainElement(canvas.getByRole('button', { name: 'Save' }))
    await expect(slip).toContainElement(canvas.getByRole('button', { name: 'Cancel' }))
    await expect(canvas.queryByText(/\/200$/)).not.toBeInTheDocument()
    // The textarea draws no edge of its own: the slip carries the one outline.
    await expect(getComputedStyle(textarea).borderTopWidth).toBe('0px')
    await expect(getComputedStyle(textarea).outlineStyle).toBe('none')
    await waitFor(() => expect(textarea).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await expect(args.onEditingChange).toHaveBeenCalledWith(false)
  },
}

export const EditingDark: Story = {
  ...Editing,
  name: 'Editing (dark)',
  globals: { theme: 'dark' },
  play: undefined,
}

/** A new note from the card's menu: an empty slip with the placeholder, already focused. */
export const EditingEmpty: Story = {
  args: { note: null, ...editing() },
  play: async ({ canvasElement }) => {
    const textarea = within(canvasElement).getByPlaceholderText('Add a note…')
    await waitFor(() => expect(textarea).toHaveFocus())
  },
}

const NEAR_CAP =
  'Marinate the thighs the night before in yoghurt, garlic and lemon. Roast at 220 until the skin blisters, then rest ten minutes. Kids want the plain rice; adults take the herb salad on the side.'

/** Past 160 characters the counter appears as a caption in the slip's muted tone; below it, it stays hidden. */
export const EditingNearCap: Story = {
  args: { note: NEAR_CAP, ...editing() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(NEAR_CAP.length).toBeGreaterThan(160)
    await expect(canvas.getByText(`${NEAR_CAP.length}/200`)).toBeInTheDocument()
    const textarea = canvas.getByRole('textbox', { name: 'Meal note' })
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Short now.')
    await expect(canvas.queryByText(/\/200$/)).not.toBeInTheDocument()
  },
}

/** Enter saves: the PATCH goes out and the new note comes back through `onNoteChange`. */
export const EnterSaves: Story = {
  args: { note: 'Leftovers', ...editing() },
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/meal-plans/:planId/entries/:entryId', () =>
          HttpResponse.json({ ok: true }),
        ),
      ],
    },
  },
  play: async ({ canvasElement, args }) => {
    const textarea = within(canvasElement).getByRole('textbox', { name: 'Meal note' })
    await waitFor(() => expect(textarea).toHaveFocus())
    await userEvent.type(textarea, ' from Sunday{Enter}')
    await waitFor(() => expect(args.onNoteChange).toHaveBeenCalledWith('Leftovers from Sunday'))
    await expect(args.onEditingChange).toHaveBeenCalledWith(false)
  },
}

/** While the save is in flight the controls are disabled and Save reads "Saving…". */
export const Saving: Story = {
  args: { note: 'Leftovers', ...editing() },
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/meal-plans/:planId/entries/:entryId', async () => {
          await delay('infinite')
          return HttpResponse.json({ ok: true })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByRole('textbox', { name: 'Meal note' })
    await waitFor(() => expect(textarea).toHaveFocus())
    await userEvent.type(textarea, '!{Enter}')
    await expect(await canvas.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    await expect(textarea).toBeDisabled()
  },
}

import { createRef } from 'react'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { dropFocusToBody } from '@/test/focus'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NoteEditor, type NoteEditorHandle } from './NoteEditor'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

describe('NoteEditor', () => {
  const defaultProps = {
    planId: 'plan-1',
    entryId: 'entry-1',
    note: null,
    onNoteChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('display mode', () => {
    it('shows "Add note" button when no note exists', () => {
      render(<NoteEditor {...defaultProps} />, { wrapper: createQueryWrapper().wrapper })
      expect(screen.getByText('Add note')).toBeInTheDocument()
    })

    it('shows note text when note exists', () => {
      render(<NoteEditor {...defaultProps} note="Eating out tonight" />, {
        wrapper: createQueryWrapper().wrapper,
      })
      expect(screen.getByText('Eating out tonight')).toBeInTheDocument()
    })

    // A saved note is a sticky-note slip, and the slip is the button that
    // opens the editor; its accessible name is the note itself.
    it('renders a saved note as a tilted slip that is the edit button', () => {
      render(<NoteEditor {...defaultProps} note="Eating out tonight" />, {
        wrapper: createQueryWrapper().wrapper,
      })
      const slip = screen.getByRole('button', { name: 'Eating out tonight' })
      expect(slip).toHaveAttribute('data-surface', 'sticky')
      expect(slip).toHaveAttribute('data-variant', 'interactive')
      expect(slip.className).toContain('-rotate-1')
      expect(slip.className).toContain('hover:rotate-0')
      expect(slip.className).toContain('motion-reduce:transition-none')
    })

    it('shows the note upright and not muted', () => {
      render(<NoteEditor {...defaultProps} note="Eating out tonight" />, {
        wrapper: createQueryWrapper().wrapper,
      })
      const text = screen.getByText('Eating out tonight')
      expect(text.className).not.toContain('italic')
      expect(text.className).not.toContain('text-muted-foreground')
    })

    it('enters edit mode when "Add note" button is clicked', async () => {
      render(<NoteEditor {...defaultProps} />, { wrapper: createQueryWrapper().wrapper })
      await userEvent.click(screen.getByText('Add note'))
      expect(screen.getByPlaceholderText('Add a note…')).toBeInTheDocument()
    })

    it('enters edit mode when existing note is clicked', async () => {
      render(<NoteEditor {...defaultProps} note="Existing note" />, {
        wrapper: createQueryWrapper().wrapper,
      })
      await userEvent.click(screen.getByText('Existing note'))
      expect(screen.getByDisplayValue('Existing note')).toBeInTheDocument()
    })
  })

  describe('edit mode', () => {
    // The counter is noise on a short note; it shows once the note is 80% of
    // the way to the 200 cap.
    it('hides the character count at 160 characters', async () => {
      render(<NoteEditor {...defaultProps} />, { wrapper: createQueryWrapper().wrapper })
      await userEvent.click(screen.getByText('Add note'))

      const textarea = screen.getByPlaceholderText('Add a note…')
      expect(screen.queryByText(/\/200$/)).not.toBeInTheDocument()
      fireEvent.change(textarea, { target: { value: 'a'.repeat(160) } })
      expect(screen.queryByText(/\/200$/)).not.toBeInTheDocument()
    })

    it('shows the character count past 160 characters', async () => {
      render(<NoteEditor {...defaultProps} />, { wrapper: createQueryWrapper().wrapper })
      await userEvent.click(screen.getByText('Add note'))

      const textarea = screen.getByPlaceholderText('Add a note…')
      fireEvent.change(textarea, { target: { value: 'a'.repeat(161) } })
      expect(screen.getByText('161/200')).toBeInTheDocument()
    })

    // The editor is the same slip, straightened; the textarea draws no border,
    // fill or outline of its own, so the slip's focus-within outline is the
    // only one.
    it('edits inside the slip with a bare textarea', async () => {
      render(<NoteEditor {...defaultProps} note="Existing note" />, {
        wrapper: createQueryWrapper().wrapper,
      })
      await userEvent.click(screen.getByText('Existing note'))

      const textarea = screen.getByRole('textbox')
      const slip = textarea.closest('[data-surface="sticky"]')
      expect(slip).toHaveAttribute('data-variant', 'editing')
      expect(slip?.className).not.toContain('-rotate-1')
      expect(textarea.className).not.toMatch(/\bborder\b/)
      expect(textarea.className).toContain('outline-none')
      expect(textarea.className).toContain('bg-transparent')
      expect(slip).toContainElement(screen.getByRole('button', { name: 'Save' }))
      expect(slip).toContainElement(screen.getByRole('button', { name: 'Cancel' }))
    })

    it('enforces 200 character limit', async () => {
      render(<NoteEditor {...defaultProps} />, { wrapper: createQueryWrapper().wrapper })
      await userEvent.click(screen.getByText('Add note'))

      const textarea = screen.getByPlaceholderText('Add a note…')
      const longText = 'a'.repeat(250)
      fireEvent.change(textarea, { target: { value: longText } })

      expect((textarea as HTMLTextAreaElement).value).toHaveLength(200)
    })

    it('cancels editing and reverts to original note', async () => {
      render(<NoteEditor {...defaultProps} note="Original note" />, {
        wrapper: createQueryWrapper().wrapper,
      })
      await userEvent.click(screen.getByText('Original note'))

      const textarea = screen.getByDisplayValue('Original note')
      await userEvent.clear(textarea)
      await userEvent.type(textarea, 'Changed note')

      await userEvent.click(screen.getByText('Cancel'))
      expect(screen.getByText('Original note')).toBeInTheDocument()
    })

    it('saves note when Save button is clicked', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })

      render(<NoteEditor {...defaultProps} />, { wrapper: createQueryWrapper().wrapper })
      await userEvent.click(screen.getByText('Add note'))

      const textarea = screen.getByPlaceholderText('Add a note…')
      await userEvent.type(textarea, 'New note')
      await userEvent.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/meal-plans/plan-1/entries/entry-1',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ note: 'New note' }),
          }),
        )
      })
    })

    it('saves note when Enter is pressed', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })

      render(<NoteEditor {...defaultProps} />, { wrapper: createQueryWrapper().wrapper })
      await userEvent.click(screen.getByText('Add note'))

      const textarea = screen.getByPlaceholderText('Add a note…')
      await userEvent.type(textarea, 'New note')
      fireEvent.keyDown(textarea, { key: 'Enter' })

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })
    })

    it('cancels editing when Escape is pressed', async () => {
      render(<NoteEditor {...defaultProps} />, { wrapper: createQueryWrapper().wrapper })
      await userEvent.click(screen.getByText('Add note'))

      const textarea = screen.getByPlaceholderText('Add a note…')
      await userEvent.type(textarea, 'Some text')
      fireEvent.keyDown(textarea, { key: 'Escape' })

      expect(screen.getByText('Add note')).toBeInTheDocument()
    })

    // A parent whose opener moves focus after the editor mounts (MealCard's
    // closing menu) refocuses the textarea through the handle (HON-946).
    it('focuses the textarea, cursor at the end, through its ref handle', async () => {
      const ref = createRef<NoteEditorHandle>()
      render(
        <NoteEditor
          {...defaultProps}
          ref={ref}
          note="Eating out"
          isEditing
          onEditingChange={vi.fn()}
        />,
        { wrapper: createQueryWrapper().wrapper },
      )
      const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
      dropFocusToBody()

      act(() => ref.current?.focus())

      expect(textarea).toHaveFocus()
      expect(textarea.selectionStart).toBe('Eating out'.length)
    })

    it('calls onNoteChange after successful save', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      const onNoteChange = vi.fn()

      render(<NoteEditor {...defaultProps} onNoteChange={onNoteChange} />, {
        wrapper: createQueryWrapper().wrapper,
      })
      await userEvent.click(screen.getByText('Add note'))

      const textarea = screen.getByPlaceholderText('Add a note…')
      await userEvent.type(textarea, 'New note')
      await userEvent.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(onNoteChange).toHaveBeenCalledWith('New note')
      })
    })

    it('sends null when clearing an existing note', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })

      render(<NoteEditor {...defaultProps} note="Existing note" />, {
        wrapper: createQueryWrapper().wrapper,
      })
      await userEvent.click(screen.getByText('Existing note'))

      const textarea = screen.getByDisplayValue('Existing note')
      await userEvent.clear(textarea)
      await userEvent.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/meal-plans/plan-1/entries/entry-1',
          expect.objectContaining({
            body: JSON.stringify({ note: null }),
          }),
        )
      })
    })
  })

  describe('compact mode', () => {
    // Compact tightens the editor (one textarea row), never the type size:
    // the note stays at the Secondary level instead of dropping to Caption
    // (HON-688).
    it('keeps the note at the Secondary level when compact', () => {
      render(<NoteEditor {...defaultProps} note="Test note" compact />, {
        wrapper: createQueryWrapper().wrapper,
      })
      const noteElement = screen.getByText('Test note')
      expect(noteElement.className).toContain('text-sm')
      expect(noteElement.className).not.toContain('text-xs')
    })

    it('renders the textarea at one row when compact', async () => {
      render(<NoteEditor {...defaultProps} compact />, { wrapper: createQueryWrapper().wrapper })
      await userEvent.click(screen.getByRole('button', { name: 'Add note' }))
      expect(screen.getByRole('textbox')).toHaveAttribute('rows', '1')
    })
  })
})

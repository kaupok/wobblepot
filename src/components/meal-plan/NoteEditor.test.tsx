import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NoteEditor } from './NoteEditor'

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
      render(<NoteEditor {...defaultProps} />)
      expect(screen.getByText('Add note')).toBeInTheDocument()
    })

    it('shows note text when note exists', () => {
      render(<NoteEditor {...defaultProps} note="Eating out tonight" />)
      expect(screen.getByText('Eating out tonight')).toBeInTheDocument()
    })

    it('enters edit mode when "Add note" button is clicked', async () => {
      render(<NoteEditor {...defaultProps} />)
      await userEvent.click(screen.getByText('Add note'))
      expect(screen.getByPlaceholderText('Add a note…')).toBeInTheDocument()
    })

    it('enters edit mode when existing note is clicked', async () => {
      render(<NoteEditor {...defaultProps} note="Existing note" />)
      await userEvent.click(screen.getByText('Existing note'))
      expect(screen.getByDisplayValue('Existing note')).toBeInTheDocument()
    })
  })

  describe('edit mode', () => {
    it('shows character count', async () => {
      render(<NoteEditor {...defaultProps} />)
      await userEvent.click(screen.getByText('Add note'))
      expect(screen.getByText('0/200')).toBeInTheDocument()
    })

    it('updates character count as user types', async () => {
      render(<NoteEditor {...defaultProps} />)
      await userEvent.click(screen.getByText('Add note'))

      const textarea = screen.getByPlaceholderText('Add a note…')
      await userEvent.type(textarea, 'Hello')
      expect(screen.getByText('5/200')).toBeInTheDocument()
    })

    it('enforces 200 character limit', async () => {
      render(<NoteEditor {...defaultProps} />)
      await userEvent.click(screen.getByText('Add note'))

      const textarea = screen.getByPlaceholderText('Add a note…')
      const longText = 'a'.repeat(250)
      fireEvent.change(textarea, { target: { value: longText } })

      expect((textarea as HTMLTextAreaElement).value).toHaveLength(200)
    })

    it('cancels editing and reverts to original note', async () => {
      render(<NoteEditor {...defaultProps} note="Original note" />)
      await userEvent.click(screen.getByText('Original note'))

      const textarea = screen.getByDisplayValue('Original note')
      await userEvent.clear(textarea)
      await userEvent.type(textarea, 'Changed note')

      await userEvent.click(screen.getByText('Cancel'))
      expect(screen.getByText('Original note')).toBeInTheDocument()
    })

    it('saves note when Save button is clicked', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })

      render(<NoteEditor {...defaultProps} />)
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
      mockFetch.mockResolvedValueOnce({ ok: true })

      render(<NoteEditor {...defaultProps} />)
      await userEvent.click(screen.getByText('Add note'))

      const textarea = screen.getByPlaceholderText('Add a note…')
      await userEvent.type(textarea, 'New note')
      fireEvent.keyDown(textarea, { key: 'Enter' })

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })
    })

    it('cancels editing when Escape is pressed', async () => {
      render(<NoteEditor {...defaultProps} />)
      await userEvent.click(screen.getByText('Add note'))

      const textarea = screen.getByPlaceholderText('Add a note…')
      await userEvent.type(textarea, 'Some text')
      fireEvent.keyDown(textarea, { key: 'Escape' })

      expect(screen.getByText('Add note')).toBeInTheDocument()
    })

    it('calls onNoteChange after successful save', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })
      const onNoteChange = vi.fn()

      render(<NoteEditor {...defaultProps} onNoteChange={onNoteChange} />)
      await userEvent.click(screen.getByText('Add note'))

      const textarea = screen.getByPlaceholderText('Add a note…')
      await userEvent.type(textarea, 'New note')
      await userEvent.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(onNoteChange).toHaveBeenCalledWith('New note')
      })
    })

    it('sends null when clearing an existing note', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })

      render(<NoteEditor {...defaultProps} note="Existing note" />)
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
    it('uses smaller text when compact prop is true', () => {
      render(<NoteEditor {...defaultProps} note="Test note" compact />)
      const noteElement = screen.getByText('Test note')
      expect(noteElement.className).toContain('text-xs')
    })
  })
})

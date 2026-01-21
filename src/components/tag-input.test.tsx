import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { useRef } from 'react'
import { TagInput, type TagInputRef } from './tag-input'

describe('TagInput component', () => {
  it('renders with placeholder when empty', () => {
    render(<TagInput value={[]} onChange={() => {}} placeholder="Add tags" />)
    expect(screen.getByPlaceholderText('Add tags')).toBeInTheDocument()
  })

  it('renders existing tags', () => {
    render(<TagInput value={['gluten', 'dairy']} onChange={() => {}} />)
    expect(screen.getByText('gluten')).toBeInTheDocument()
    expect(screen.getByText('dairy')).toBeInTheDocument()
  })

  it('hides placeholder when tags exist', () => {
    render(<TagInput value={['gluten']} onChange={() => {}} placeholder="Add tags" />)
    expect(screen.queryByPlaceholderText('Add tags')).not.toBeInTheDocument()
  })

  describe('adding tags', () => {
    it('adds a tag when Enter is pressed', async () => {
      const onChange = vi.fn()
      render(<TagInput value={[]} onChange={onChange} />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'newTag{enter}')

      expect(onChange).toHaveBeenCalledWith(['newTag'])
    })

    it('trims whitespace from tags', async () => {
      const onChange = vi.fn()
      render(<TagInput value={[]} onChange={onChange} />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, '  spaced tag  {enter}')

      expect(onChange).toHaveBeenCalledWith(['spaced tag'])
    })

    it('clears input after adding a tag', async () => {
      const onChange = vi.fn()
      render(<TagInput value={[]} onChange={onChange} />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'newTag{enter}')

      expect(input).toHaveValue('')
    })

    it('does not add empty tags', async () => {
      const onChange = vi.fn()
      render(<TagInput value={[]} onChange={onChange} />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, '   {enter}')

      expect(onChange).not.toHaveBeenCalled()
    })

    it('prevents duplicate tags', async () => {
      const onChange = vi.fn()
      render(<TagInput value={['existing']} onChange={onChange} />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'existing{enter}')

      expect(onChange).not.toHaveBeenCalled()
    })

    it('adds a tag on blur', async () => {
      const onChange = vi.fn()
      render(<TagInput value={[]} onChange={onChange} />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'blurTag')
      fireEvent.blur(input)

      expect(onChange).toHaveBeenCalledWith(['blurTag'])
    })

    it('does not add empty tag on blur', async () => {
      const onChange = vi.fn()
      render(<TagInput value={[]} onChange={onChange} />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, '   ')
      fireEvent.blur(input)

      expect(onChange).not.toHaveBeenCalled()
    })

    it('clears input after blur commits tag', async () => {
      const onChange = vi.fn()
      render(<TagInput value={[]} onChange={onChange} />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'blurTag')
      fireEvent.blur(input)

      expect(input).toHaveValue('')
    })

    it('prevents form submission on Enter', async () => {
      const onSubmit = vi.fn((e) => e.preventDefault())
      render(
        <form onSubmit={onSubmit}>
          <TagInput value={[]} onChange={() => {}} />
        </form>,
      )

      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'tag{enter}')

      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  describe('removing tags', () => {
    it('removes a tag when clicking the remove button', async () => {
      const onChange = vi.fn()
      render(<TagInput value={['gluten', 'dairy']} onChange={onChange} />)

      const removeButton = screen.getByLabelText('Remove gluten')
      await userEvent.click(removeButton)

      expect(onChange).toHaveBeenCalledWith(['dairy'])
    })

    it('removes last tag on Backspace when input is empty', async () => {
      const onChange = vi.fn()
      render(<TagInput value={['gluten', 'dairy']} onChange={onChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.keyDown(input, { key: 'Backspace' })

      expect(onChange).toHaveBeenCalledWith(['gluten'])
    })

    it('does not remove tag on Backspace when input has value', async () => {
      const onChange = vi.fn()
      render(<TagInput value={['gluten', 'dairy']} onChange={onChange} />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'text')
      fireEvent.keyDown(input, { key: 'Backspace' })

      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('disabled state', () => {
    it('disables the input when disabled prop is true', () => {
      render(<TagInput value={[]} onChange={() => {}} disabled />)
      expect(screen.getByRole('textbox')).toBeDisabled()
    })

    it('hides remove buttons when disabled', () => {
      render(<TagInput value={['gluten']} onChange={() => {}} disabled />)
      expect(screen.queryByLabelText('Remove gluten')).not.toBeInTheDocument()
    })

    it('applies disabled styles to container', () => {
      render(<TagInput value={[]} onChange={() => {}} disabled />)
      const wrapper = screen.getByTestId('tag-input-container')
      expect(wrapper).toHaveClass('opacity-50', 'cursor-not-allowed')
    })
  })

  describe('custom className', () => {
    it('applies custom className to container', () => {
      render(<TagInput value={[]} onChange={() => {}} className="custom-class" />)
      const wrapper = screen.getByTestId('tag-input-container')
      expect(wrapper).toHaveClass('custom-class')
    })
  })

  describe('accessibility', () => {
    it('supports id prop for labels', () => {
      render(
        <>
          <label htmlFor="my-tags">Tags</label>
          <TagInput id="my-tags" value={[]} onChange={() => {}} />
        </>,
      )
      expect(screen.getByLabelText('Tags')).toBeInTheDocument()
    })

    it('has accessible remove buttons', () => {
      render(<TagInput value={['gluten']} onChange={() => {}} />)
      expect(screen.getByRole('button', { name: 'Remove gluten' })).toBeInTheDocument()
    })
  })

  describe('commitPendingValue via ref', () => {
    function RefTestWrapper({
      onChange,
      value = [],
    }: {
      onChange: (value: string[]) => void
      value?: string[]
    }) {
      const ref = useRef<TagInputRef>(null)
      return (
        <>
          <TagInput ref={ref} value={value} onChange={onChange} />
          <button type="button" onClick={() => ref.current?.commitPendingValue()}>
            Commit
          </button>
        </>
      )
    }

    it('commits pending value when called', async () => {
      const onChange = vi.fn()
      render(<RefTestWrapper onChange={onChange} />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'refTag')
      await userEvent.click(screen.getByText('Commit'))

      expect(onChange).toHaveBeenCalledWith(['refTag'])
    })

    it('does not add empty value when commitPendingValue called', async () => {
      const onChange = vi.fn()
      render(<RefTestWrapper onChange={onChange} />)

      await userEvent.click(screen.getByText('Commit'))

      expect(onChange).not.toHaveBeenCalled()
    })

    it('clears input after commitPendingValue', async () => {
      const onChange = vi.fn()
      render(<RefTestWrapper onChange={onChange} />)

      const input = screen.getByRole('textbox')
      await userEvent.type(input, 'refTag')
      await userEvent.click(screen.getByText('Commit'))

      expect(input).toHaveValue('')
    })
  })
})

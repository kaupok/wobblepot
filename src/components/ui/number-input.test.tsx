import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { NumberInput } from './number-input'

function ControlledHarness({
  initial = null,
  onValueChange,
  integer = false,
}: {
  initial?: number | null
  onValueChange?: (v: number | null) => void
  integer?: boolean
}) {
  const [value, setValue] = useState<number | null>(initial)
  return (
    <NumberInput
      aria-label="quantity"
      value={value}
      integer={integer}
      onValueChange={(v) => {
        setValue(v)
        onValueChange?.(v)
      }}
    />
  )
}

describe('NumberInput', () => {
  it('renders as a text input with inputMode="decimal" by default', () => {
    render(<NumberInput aria-label="quantity" value={1.5} onValueChange={() => {}} />)
    const input = screen.getByLabelText('quantity') as HTMLInputElement
    expect(input.type).toBe('text')
    expect(input).toHaveAttribute('inputmode', 'decimal')
    expect(input.value).toBe('1.5')
  })

  it('uses inputMode="numeric" when integer is true', () => {
    render(<NumberInput aria-label="servings" value={4} integer onValueChange={() => {}} />)
    const input = screen.getByLabelText('servings')
    expect(input).toHaveAttribute('inputmode', 'numeric')
  })

  it('shows an empty draft when value is null', () => {
    render(<NumberInput aria-label="q" value={null} onValueChange={() => {}} />)
    const input = screen.getByLabelText('q') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('fires onValueChange with parsed dot-decimal input', () => {
    const onValueChange = vi.fn()
    render(<ControlledHarness onValueChange={onValueChange} />)
    const input = screen.getByLabelText('quantity') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1.5' } })
    expect(onValueChange).toHaveBeenLastCalledWith(1.5)
    expect(input.value).toBe('1.5')
  })

  it('fires onValueChange with parsed comma-decimal input (Estonian)', () => {
    const onValueChange = vi.fn()
    render(<ControlledHarness onValueChange={onValueChange} />)
    const input = screen.getByLabelText('quantity') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1,5' } })
    expect(onValueChange).toHaveBeenLastCalledWith(1.5)
    // Draft is preserved so the user sees their comma-style input.
    expect(input.value).toBe('1,5')
  })

  it('preserves the draft when input is currently unparseable', () => {
    const onValueChange = vi.fn()
    render(<ControlledHarness onValueChange={onValueChange} />)
    const input = screen.getByLabelText('quantity') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1,' } })
    expect(onValueChange).toHaveBeenLastCalledWith(null)
    // Typing `1,` is intermediate — the draft must survive so the user can
    // finish with `1,5`.
    expect(input.value).toBe('1,')
  })

  it('resyncs draft when value changes externally', () => {
    function Parent() {
      const [value, setValue] = useState<number | null>(1)
      return (
        <>
          <NumberInput aria-label="q" value={value} onValueChange={setValue} />
          <button type="button" onClick={() => setValue(2.5)}>
            set external
          </button>
        </>
      )
    }
    render(<Parent />)
    const input = screen.getByLabelText('q') as HTMLInputElement
    expect(input.value).toBe('1')
    fireEvent.click(screen.getByText('set external'))
    expect(input.value).toBe('2.5')
  })

  it('does not resync draft when parent merely echoes our own value', () => {
    // Parent receives our reported value and sets state to it. Draft should
    // not churn; the user-entered comma form must persist.
    render(<ControlledHarness />)
    const input = screen.getByLabelText('quantity') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1,5' } })
    expect(input.value).toBe('1,5')
    // Trigger another change — the harness round-trips value=1.5 on every
    // keystroke. The comma form must still stand.
    fireEvent.change(input, { target: { value: '2,5' } })
    expect(input.value).toBe('2,5')
  })

  it('preserves intermediate partial input when parent coerces null to a number', () => {
    // Call sites like QuantityControls / ComponentList store the value as
    // `number` and must not zero it out mid-keystroke. If they routed null
    // to a numeric fallback (e.g. `v ?? 0`), NumberInput would see the
    // coerced value come back as an external change and resync the draft —
    // wiping the user's `1.` as they type `1.5`. This test guards against
    // that regression.
    function CoercingParent() {
      const [value, setValue] = useState<number>(100)
      return (
        <NumberInput
          aria-label="q"
          value={value}
          onValueChange={(v) => {
            if (v !== null) setValue(v)
          }}
        />
      )
    }
    render(<CoercingParent />)
    const input = screen.getByLabelText('q') as HTMLInputElement
    // User types `1` then `.` on the way to `1.5`. The trailing-separator
    // draft must survive so the next keystroke (`5`) builds `1.5`.
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.change(input, { target: { value: '1.' } })
    expect(input.value).toBe('1.')
    fireEvent.change(input, { target: { value: '1.5' } })
    expect(input.value).toBe('1.5')
  })

  it('rejects fractional values in integer mode', () => {
    const onValueChange = vi.fn()
    render(<ControlledHarness onValueChange={onValueChange} integer />)
    const input = screen.getByLabelText('quantity') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1,5' } })
    expect(onValueChange).toHaveBeenLastCalledWith(null)
    fireEvent.change(input, { target: { value: '4' } })
    expect(onValueChange).toHaveBeenLastCalledWith(4)
  })

  it('restores the value on blur if the draft is garbage', () => {
    function Parent() {
      const [value, setValue] = useState<number | null>(1.5)
      return (
        <NumberInput
          aria-label="q"
          value={value}
          onValueChange={(v) => {
            // Parent keeps old value if parse fails — common pattern.
            if (v !== null) setValue(v)
          }}
        />
      )
    }
    render(<Parent />)
    const input = screen.getByLabelText('q') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'garbage' } })
    expect(input.value).toBe('garbage')
    fireEvent.blur(input)
    expect(input.value).toBe('1.5')
  })

  it('forwards disabled and className props', () => {
    render(
      <NumberInput aria-label="q" value={1} onValueChange={() => {}} disabled className="w-24" />,
    )
    const input = screen.getByLabelText('q')
    expect(input).toBeDisabled()
    expect(input).toHaveClass('w-24')
  })

  it('forwards ref to the underlying input', () => {
    const ref = { current: null as HTMLInputElement | null }
    render(<NumberInput ref={ref} aria-label="q" value={1} onValueChange={() => {}} />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })
})

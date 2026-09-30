import { describe, it, expect, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRefocusAfterPending } from './use-refocus-after-pending'

function setup() {
  const button = document.createElement('button')
  document.body.appendChild(button)
  const hook = renderHook(({ isPending }) => useRefocusAfterPending(isPending), {
    initialProps: { isPending: true },
  })
  hook.result.current.ref.current = button
  return { button, ...hook }
}

describe('useRefocusAfterPending', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('focuses the control once pending ends, when a refocus was requested', () => {
    const { button, result, rerender } = setup()

    act(() => result.current.requestRefocus())
    expect(button).not.toHaveFocus()

    rerender({ isPending: false })
    expect(button).toHaveFocus()
  })

  it('leaves focus alone when no refocus was requested', () => {
    const { button, rerender } = setup()

    rerender({ isPending: false })
    expect(button).not.toHaveFocus()
  })

  it('refocuses once per request', () => {
    const { button, result, rerender } = setup()

    act(() => result.current.requestRefocus())
    rerender({ isPending: false })
    act(() => button.blur())

    rerender({ isPending: true })
    rerender({ isPending: false })
    expect(button).not.toHaveFocus()
  })
})

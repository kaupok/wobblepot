import { act } from '@testing-library/react'
import { expect } from 'vitest'

/**
 * Move focus to `<body>`, as Chromium does when the focused control becomes
 * `disabled`. jsdom keeps focus on a disabled control (and ignores `blur()` on
 * one), so a test of a refocus-after-pending fix calls this while the request
 * is pending; without it the control never loses focus and the test passes
 * without the fix.
 */
export function dropFocusToBody() {
  act(() => {
    document.body.tabIndex = -1
    document.body.focus()
    document.body.removeAttribute('tabindex')
  })
  expect(document.body).toHaveFocus()
}

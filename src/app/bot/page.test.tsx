import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import BotPage from './page'

describe('BotPage', () => {
  it('links the privacy contact address (HON-645)', () => {
    render(<BotPage />)
    // Literal on purpose: asserting against PRIVACY_EMAIL would pass whatever the constant became.
    expect(screen.getByRole('link', { name: 'privacy@wobblepot.com' })).toHaveAttribute(
      'href',
      'mailto:privacy@wobblepot.com',
    )
  })
})

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

  it('shows the bot user-agent and robots token (HON-670)', () => {
    render(<BotPage />)
    // Literals on purpose: asserting against the bot-identity constants would pass whatever they became.
    expect(screen.getByText('Wobblepot-Bot/1.0 (+https://wobblepot.com/bot)')).toBeInTheDocument()
    expect(screen.getAllByText('Wobblepot-Bot/1.0', { selector: 'code' })).toHaveLength(3)
  })
})

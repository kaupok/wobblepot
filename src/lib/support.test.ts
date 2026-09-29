import { describe, it, expect } from 'vitest'
import { supportMailtoHref } from './support'

describe('supportMailtoHref', () => {
  it('addresses support and percent-encodes the subject', () => {
    expect(supportMailtoHref('Invite request')).toBe(
      'mailto:support@wobblepot.com?subject=Invite%20request',
    )
  })

  it('encodes non-ASCII and reserved characters', () => {
    expect(supportMailtoHref('Küsi & kutset?')).toBe(
      'mailto:support@wobblepot.com?subject=K%C3%BCsi%20%26%20kutset%3F',
    )
  })
})

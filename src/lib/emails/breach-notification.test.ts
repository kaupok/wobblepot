import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateBreachNotificationEmail } from './breach-notification'

// Mock the env module
vi.mock('@/lib/env', () => ({
  serverEnv: {
    NEXT_PUBLIC_APP_NAME: 'TestApp',
  },
}))

describe('generateBreachNotificationEmail', () => {
  const options = {
    summary: 'We detected unauthorized access to one of our systems.',
    impact: 'Your email address and meal-plan history may have been exposed.',
    remediation: 'Change your password and watch for phishing emails.',
    supportUrl: 'https://example.com/status',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns object with subject, html, and text', () => {
    const result = generateBreachNotificationEmail(options)

    expect(result).toHaveProperty('subject')
    expect(result).toHaveProperty('html')
    expect(result).toHaveProperty('text')
  })

  it('includes app name in subject', () => {
    const result = generateBreachNotificationEmail(options)

    expect(result.subject).toBe('Important security notice about your TestApp account')
  })

  it('includes the summary in HTML and plain text', () => {
    const result = generateBreachNotificationEmail(options)

    expect(result.html).toContain(options.summary)
    expect(result.text).toContain(options.summary)
  })

  it('includes the impact in HTML and plain text', () => {
    const result = generateBreachNotificationEmail(options)

    expect(result.html).toContain(options.impact)
    expect(result.text).toContain(options.impact)
  })

  it('includes the remediation in HTML and plain text', () => {
    const result = generateBreachNotificationEmail(options)

    expect(result.html).toContain(options.remediation)
    expect(result.text).toContain(options.remediation)
  })

  it('includes the support URL in HTML and plain text', () => {
    const result = generateBreachNotificationEmail(options)

    expect(result.html).toContain(options.supportUrl)
    expect(result.text).toContain(options.supportUrl)
  })

  it('includes app name in HTML and plain text content', () => {
    const result = generateBreachNotificationEmail(options)

    expect(result.html).toContain('TestApp')
    expect(result.text).toContain('TestApp')
  })

  it('labels the affected-data and remediation sections', () => {
    const result = generateBreachNotificationEmail(options)

    expect(result.html).toContain('What was affected')
    expect(result.html).toContain('What you should do')
    expect(result.text).toContain('What was affected')
    expect(result.text).toContain('What you should do')
  })

  it('escapes HTML-significant characters in operator-typed fields (HTML only)', () => {
    const result = generateBreachNotificationEmail({
      summary: 'Some <unauthorized> access & a "leak" happened',
      impact: 'Records with <tags> & "quotes" were exposed',
      remediation: 'Change your password & stay alert',
      supportUrl: 'https://example.com/status?a=1&b=2',
    })

    // HTML branch is escaped: no raw angle brackets from the input survive.
    expect(result.html).toContain(
      'Some &lt;unauthorized&gt; access &amp; a &quot;leak&quot; happened',
    )
    expect(result.html).toContain('href="https://example.com/status?a=1&amp;b=2"')
    expect(result.html).not.toContain('<unauthorized>')

    // Plain text is left raw — no HTML entities there.
    expect(result.text).toContain('Some <unauthorized> access & a "leak" happened')
    expect(result.text).toContain('https://example.com/status?a=1&b=2')
    expect(result.text).not.toContain('&lt;')
  })
})

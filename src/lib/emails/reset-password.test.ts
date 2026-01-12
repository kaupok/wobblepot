import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateResetPasswordEmail } from './reset-password'

// Mock the env module
vi.mock('@/lib/env', () => ({
  serverEnv: {
    NEXT_PUBLIC_APP_NAME: 'TestApp',
  },
}))

describe('generateResetPasswordEmail', () => {
  const resetUrl = 'https://example.com/reset-password?token=abc123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns object with subject, html, and text', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result).toHaveProperty('subject')
    expect(result).toHaveProperty('html')
    expect(result).toHaveProperty('text')
  })

  it('includes app name in subject', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.subject).toBe('Reset your TestApp password')
  })

  it('includes reset URL in HTML content', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.html).toContain(resetUrl)
  })

  it('includes reset URL in plain text content', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.text).toContain(resetUrl)
  })

  it('includes app name in HTML content', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.html).toContain('TestApp')
  })

  it('includes app name in plain text content', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.text).toContain('TestApp')
  })

  it('includes security notice about expiration', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.html).toContain('expire')
    expect(result.text).toContain('expire')
  })

  it('includes message about ignoring if not requested', () => {
    const result = generateResetPasswordEmail({ resetUrl })

    expect(result.html).toContain("didn't request")
    expect(result.text).toContain("didn't request")
  })
})

import { describe, expect, it } from 'vitest'
import { POSTHOG_INIT_OPTIONS } from '@/lib/posthog-init-options'
import { postHogBeforeSend } from '@/lib/posthog-before-send'

// Both inits (PostHogProvider, global-error) are asserted to pass exactly this
// object, so the literal values are asserted here, once.
describe('POSTHOG_INIT_OPTIONS', () => {
  it('routes through the same-origin proxy (HON-985)', () => {
    expect(POSTHOG_INIT_OPTIONS.api_host).toBe('/ingest')
    expect(POSTHOG_INIT_OPTIONS.ui_host).toBe('https://eu.posthog.com')
  })

  it('turns pageleave on although pageviews are captured by hand (HON-984)', () => {
    expect(POSTHOG_INIT_OPTIONS.capture_pageview).toBe(false)
    expect(POSTHOG_INIT_OPTIONS.capture_pageleave).toBe(true)
  })

  it('keeps session recording and surveys off', () => {
    expect(POSTHOG_INIT_OPTIONS.disable_session_recording).toBe(true)
    expect(POSTHOG_INIT_OPTIONS.disable_surveys).toBe(true)
  })

  it('pins exception autocapture so the remote toggle cannot change it', () => {
    expect(POSTHOG_INIT_OPTIONS.capture_exceptions).toEqual({
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    })
  })

  it('pins the config defaults and the sanitiser', () => {
    expect(POSTHOG_INIT_OPTIONS.defaults).toBe('2026-01-30')
    expect(POSTHOG_INIT_OPTIONS.before_send).toBe(postHogBeforeSend)
  })

  // HON-990: the /flags request skips before_send, so the reset token and the
  // invite returnUrl are masked at the source.
  it('masks the reset token and the invite returnUrl at the source', () => {
    expect(POSTHOG_INIT_OPTIONS.mask_personal_data_properties).toBe(true)
    expect(POSTHOG_INIT_OPTIONS.custom_personal_data_properties).toEqual(['token', 'returnUrl'])
  })

  it('does not opt out by default: init only runs after consent', () => {
    expect(POSTHOG_INIT_OPTIONS).not.toHaveProperty('opt_out_capturing_by_default')
  })
})

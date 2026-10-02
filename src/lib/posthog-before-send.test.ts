import { describe, expect, it } from 'vitest'
import { postHogBeforeSend } from '@/lib/posthog-before-send'

describe('postHogBeforeSend', () => {
  it('passes null through', () => {
    expect(postHogBeforeSend(null)).toBeNull()
  })

  it('keeps $pageleave and its $prev_pageview_* properties for web analytics', () => {
    const event = {
      event: '$pageleave',
      properties: {
        $current_url: 'https://wobblepot.dev/meal-plan',
        $prev_pageview_pathname: '/meal-plan',
        $prev_pageview_duration: 12.5,
        $prev_pageview_max_scroll_percentage: 0.8,
        token: 'phc_test',
      },
    }

    const result = postHogBeforeSend(event)

    expect(result).not.toBeNull()
    expect(result?.event).toBe('$pageleave')
    expect(result?.properties).toEqual(event.properties)
  })

  it('strips sensitive keys but re-stamps the project token', () => {
    const result = postHogBeforeSend({
      properties: { email: 'a@example.com', token: 'phc_test' },
    })

    expect(result?.properties).toEqual({ token: 'phc_test' })
  })

  it('drops the reset token from a $pageview URL', () => {
    const result = postHogBeforeSend({
      event: '$pageview',
      properties: {
        $current_url: 'https://wobblepot.com/reset-password?token=abc',
        $pathname: '/reset-password',
        token: 'phc_test',
      },
    })

    expect(result?.properties).toEqual({
      $current_url: 'https://wobblepot.com/reset-password',
      $pathname: '/reset-password',
      token: 'phc_test',
    })
  })

  it('replaces the invite code in a $pageview path', () => {
    const result = postHogBeforeSend({
      event: '$pageview',
      properties: {
        $current_url: 'https://wobblepot.com/invite/XYZ123',
        $pathname: '/invite/XYZ123',
        token: 'phc_test',
      },
    })

    expect(result?.properties.$current_url).toBe('https://wobblepot.com/invite/:code')
    expect(result?.properties.$pathname).toBe('/invite/:code')
  })

  it('drops the invite returnUrl from $referrer', () => {
    const result = postHogBeforeSend({
      event: '$pageview',
      properties: {
        $referrer: 'https://wobblepot.com/sign-in?returnUrl=%2Finvite%2FXYZ123',
        token: 'phc_test',
      },
    })

    expect(result?.properties.$referrer).toBe('https://wobblepot.com/sign-in')
  })

  it('redacts the initial URL on the person properties', () => {
    const result = postHogBeforeSend({
      event: '$identify',
      properties: { token: 'phc_test' },
      $set: { $current_url: 'https://wobblepot.com/invite/XYZ123' },
      $set_once: {
        $initial_current_url: 'https://wobblepot.com/reset-password?token=abc',
        $initial_pathname: '/invite/XYZ123',
      },
    })

    expect(result?.$set).toEqual({ $current_url: 'https://wobblepot.com/invite/:code' })
    expect(result?.$set_once).toEqual({
      $initial_current_url: 'https://wobblepot.com/reset-password',
      $initial_pathname: '/invite/:code',
    })
  })

  it('does not add $set or $set_once when the event has none', () => {
    const result = postHogBeforeSend({ properties: { token: 'phc_test' } })

    expect(result).toEqual({ properties: { token: 'phc_test' } })
  })
})

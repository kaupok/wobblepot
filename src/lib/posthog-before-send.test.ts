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
})

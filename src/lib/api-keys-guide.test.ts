import { describe, expect, it } from 'vitest'

import { apiV1Urls, homeAssistantExample } from './api-keys-guide'

describe('apiV1Urls (HON-1228)', () => {
  it('builds both endpoints on the given host', () => {
    expect(apiV1Urls('https://wobblepot.com')).toEqual({
      mealPlan: 'https://wobblepot.com/api/v1/meal-plan',
      shoppingList: 'https://wobblepot.com/api/v1/shopping-list',
    })
  })

  it('does not double the slash when the base ends in one', () => {
    expect(apiV1Urls('https://wobblepot.dev/').mealPlan).toBe(
      'https://wobblepot.dev/api/v1/meal-plan',
    )
  })
})

describe('homeAssistantExample (HON-1228)', () => {
  const yaml = homeAssistantExample('https://wobblepot.dev')

  it('reads the meal plan on the given host', () => {
    expect(yaml).toContain('  - resource: https://wobblepot.dev/api/v1/meal-plan\n')
  })

  it('polls every 5 minutes, not Home Assistant’s 30-second default', () => {
    expect(yaml).toContain('    scan_interval: 300\n')
  })

  it('takes the key from secrets.yaml', () => {
    expect(yaml).toContain('      Authorization: !secret wobblepot_api_key\n')
  })

  it('starts at `rest:`, with no `# configuration.yaml` comment', () => {
    expect(yaml.startsWith('rest:\n')).toBe(true)
    expect(yaml).not.toContain('# configuration.yaml')
  })
})

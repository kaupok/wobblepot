/**
 * What the "Use the key" part of My account → Connections shows (HON-1228): the two
 * read-only endpoints for this host and a Home Assistant example. Client-safe,
 * unlike `src/lib/api-keys.ts`.
 *
 * Keep in step with `docs/API.md` → Endpoints and → Home Assistant example:
 * a change to one changes the other.
 */

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export interface ApiV1Urls {
  mealPlan: string
  shoppingList: string
}

/** The endpoints a key reads, on the host `getServerBaseURL()` returned. */
export function apiV1Urls(baseUrl: string): ApiV1Urls {
  const base = trimBase(baseUrl)
  return {
    mealPlan: `${base}/api/v1/meal-plan`,
    shoppingList: `${base}/api/v1/shopping-list`,
  }
}

/**
 * The `configuration.yaml` block from docs/API.md, for this host. It has no
 * `# configuration.yaml` comment: the line above it on the page says where it
 * goes. `scan_interval: 300` keeps Home Assistant at 12 requests an hour; its
 * 30-second default alone uses the household's 120.
 */
export function homeAssistantExample(baseUrl: string): string {
  return `rest:
  - resource: ${apiV1Urls(baseUrl).mealPlan}
    scan_interval: 300
    headers:
      Authorization: !secret wobblepot_api_key
    sensor:
      - name: Dinner today
        unique_id: wobblepot_dinner_today
        value_template: >
          {% set dinner = value_json.entries
               | selectattr('date', 'eq', value_json.from)
               | selectattr('mealType', 'eq', 'dinner')
               | rejectattr('isSkipped')
               | list %}
          {{ dinner[0].mealName if dinner and dinner[0].mealName else 'Nothing planned' }}
`
}

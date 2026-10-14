# Wobblepot read-only API

Two JSON endpoints for a kitchen screen, an e-ink frame, a Home Assistant dashboard or a script (HON-1220). They answer with the same JSON as the MCP read tools `get_meal_plan` and `get_shopping_list` ([MCP_SERVER.md](MCP_SERVER.md)), so a dish name, a date and a skipped meal read the same everywhere.

An AI assistant uses the MCP server, not this API. The security model is in [SECURITY.md](SECURITY.md) → Read-only API keys.

## The key

Make a key on the profile page, under "Screens and scripts": give it a name that says what will use it, choose Create key, and copy the key. Wobblepot shows it once and keeps only its hash, so a lost key cannot be shown again: revoke it and make a new one.

- A key is `wp_` followed by 32 letters and digits.
- A key can only read. It works on the two endpoints below and nowhere else.
- A key belongs to its member and reads the household the member belongs to at the time of each request. After the member leaves a household, the key no longer reads it; deleting the account stops the key.
- Revoke deletes the key. Its next request answers `401`.
- A member can have 10 keys at most.

Send the key in the `Authorization` header, never in the URL:

```
Authorization: Bearer wp_…
```

## Endpoints

Base URL: `https://wobblepot.com` (staging: `https://wobblepot.dev`). Every answer is JSON with `Cache-Control: no-store`. The API sends no CORS headers, so a web page on another site cannot call it from a browser.

### `GET /api/v1/meal-plan`

The meals planned by date and meal type.

| Query  | Value        | Default                                           |
| ------ | ------------ | ------------------------------------------------- |
| `from` | `YYYY-MM-DD` | Today, in the household's timezone                |
| `to`   | `YYYY-MM-DD` | 6 days after `from`. At most 31 days from `from`. |

```json
{
  "from": "2026-10-14",
  "to": "2026-10-20",
  "entries": [
    {
      "date": "2026-10-14",
      "mealType": "dinner",
      "mealId": "cm…",
      "mealName": "Chicken soup",
      "servings": 4,
      "isCooked": false,
      "isSkipped": false
    }
  ]
}
```

`mealType` is `breakfast`, `lunch` or `dinner`. `mealId` and `mealName` are `null` for an entry with no meal. Dish names are in the household's language.

### `GET /api/v1/shopping-list`

What to buy for the planned meals, plus the items the household added by hand.

| Query  | Value       | Default |
| ------ | ----------- | ------- |
| `days` | `7` or `14` | `7`     |

```json
{
  "days": 7,
  "items": [
    {
      "ingredientId": "cm…",
      "name": "Carrot",
      "quantity": 300,
      "unit": "g",
      "displayQuantity": "300g",
      "category": "vegetable",
      "neededBy": "2026-10-15",
      "purchased": false
    }
  ],
  "customItems": [{ "id": "cm…", "name": "Candles", "checked": false }]
}
```

An item with `purchased: true` is already in the pantry.

## Errors

Every error is `{ "error": "<a sentence for the developer>", "code": "<code>" }`.

| Status | `code`           | When                                                                                          |
| ------ | ---------------- | --------------------------------------------------------------------------------------------- |
| `400`  | `bad_request`    | A date that is not `YYYY-MM-DD`, `to` before `from`, more than 31 days, or `days` not 7 or 14 |
| `401`  | `invalid_key`    | No key, a malformed key, a revoked key, or the key of an account waiting for deletion         |
| `403`  | `no_household`   | The account has no household: finish onboarding in Wobblepot first                            |
| `429`  | `rate_limited`   | The household made too many requests. `Retry-After` says how many seconds to wait             |
| `500`  | `internal_error` | Wobblepot could not answer. Try again later                                                   |

## How often to poll

A household may make 120 requests an hour across all its keys. That limit is apart from an assistant's MCP limit, so a screen cannot use up the assistant's requests.

Poll at most once a minute; every 5 minutes is enough for a meal plan. Home Assistant's REST sensor polls every 30 seconds unless you set `scan_interval`, which alone is 120 requests an hour, so always set it.

## Home Assistant example

Today's dinner, refreshed every 5 minutes. Put the key in `secrets.yaml` as `wobblepot_api_key: "Bearer wp_…"`.

```yaml
# configuration.yaml
rest:
  - resource: https://wobblepot.com/api/v1/meal-plan
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
               | list %}
          {{ dinner[0].mealName if dinner and dinner[0].mealName else 'Nothing planned' }}
```

## curl

```sh
curl -H "Authorization: Bearer $WOBBLEPOT_API_KEY" \
  "https://wobblepot.com/api/v1/shopping-list?days=14"
```

## Versioning

The `v1` paths keep their shape: a field may be added, but none is renamed or removed. A change that breaks a caller gets a new version path.

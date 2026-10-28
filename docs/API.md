# Wobblepot read-only API

Two JSON endpoints for a kitchen screen, an e-ink frame, a Home Assistant dashboard or a script (HON-1220). They answer with the same JSON as the MCP read tools `get_meal_plan` and `get_shopping_list` ([MCP_SERVER.md](MCP_SERVER.md)), so a dish name, a date and a skipped meal read the same everywhere.

An AI assistant uses the MCP server, not this API. The security model is in [SECURITY.md](SECURITY.md) → Read-only API keys.

## The key

Make a key on My account → Connections (`/account/connections`), under "Screens and scripts": give it a name that says what will use it, choose Create key, and copy the key. Wobblepot shows it once and keeps only its hash, so a lost key cannot be shown again: revoke it and make a new one.

Below the form, "Use the key" shows the two endpoint URLs for the current host with Copy, three steps, and the Home Assistant example below with that host filled in (HON-1228).

- A key is `wp_` followed by 32 letters and digits.
- A key can only read. It works on the two endpoints below and nowhere else.
- A key belongs to its member and reads the household the member belongs to at the time of each request. After the member leaves a household, the key no longer reads it; deleting the account stops the key.
- A key can expire. "Expires in (optional)" takes 1 to 365 days; left empty, the key does not expire. After that time the key answers `401`, and My account → Connections lists it as "Expired" until it is revoked.
- Revoke deletes the key. Its next request answers `401`.
- The household's owner sees every member's keys on My account → Connections, with the member's name, and can revoke any of them. Any other member sees and revokes their own keys only (HON-1221).
- A member can have 10 keys at most. An expired key counts until it is revoked.

Send the key in the `Authorization` header, never in the URL:

```
Authorization: Bearer wp_…
```

## Endpoints

Base URL: `https://wobblepot.com` (staging: `https://wobblepot.dev`). Every answer is JSON with `Cache-Control: no-store`. The API sends no CORS headers, so a web page on another site cannot call it from a browser.

### `GET /api/v1/meal-plan`

The meals planned by date and meal type, and each day's extras.

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
      "entryId": "cm…",
      "date": "2026-10-14",
      "mealType": "dinner",
      "kind": "recipe",
      "items": [],
      "mealId": "cm…",
      "mealName": "Chicken soup",
      "servings": 4,
      "cookServings": 6.5,
      "leftoversFor": [{ "date": "2026-10-15", "mealType": "lunch", "servings": 2.5 }],
      "isCooked": false,
      "isSkipped": false
    },
    {
      "entryId": "cm…",
      "date": "2026-10-15",
      "mealType": "lunch",
      "kind": "fridge",
      "items": [
        { "name": "Frozen peas", "source": "pantry", "sourceEntryId": null, "servings": null },
        { "name": "Chicken soup", "source": "leftover", "sourceEntryId": "cm…", "servings": 2.5 },
        { "name": "Meatballs", "source": "text", "sourceEntryId": null, "servings": null }
      ],
      "mealId": null,
      "mealName": null,
      "servings": 4,
      "cookServings": 4,
      "leftoversFor": [],
      "isCooked": false,
      "isSkipped": false
    }
  ],
  "extras": [
    {
      "id": "cm…",
      "date": "2026-10-14",
      "name": "Red wine",
      "kind": "ingredient",
      "quantity": 750,
      "unit": "ml"
    },
    {
      "id": "cm…",
      "date": "2026-10-14",
      "name": "chips",
      "kind": "text",
      "quantity": null,
      "unit": null
    }
  ]
}
```

`mealType` is `breakfast`, `lunch` or `dinner`. `mealId` and `mealName` are `null` for an entry with no meal. Dish names are in the household's language.

`kind` is `recipe` for a meal from a recipe, or `fridge` for a fridge meal: a planned meal made of what is at home, with no recipe (HON-1281). A fridge meal lists its `items` in order; `items` is empty for `recipe`. An item's `source` is `pantry` (an ingredient, named in the household's language), `leftover` (what is left of an earlier meal, cooked or planned, named by that meal; `null` when the meal was deleted since) or `text` (the household's own words). A leftover item carries its meal's `sourceEntryId` and the `servings` it takes (`null` when none was set); both are `null` on the other items.

`servings` is the meal's own servings: the household's, or the entry's override. `cookServings` is what the meal is cooked and bought for: `servings` plus the servings of every fridge meal that is not skipped and takes its leftovers, listed in `leftoversFor` (HON-1394). Once the meal is cooked, `cookServings` is the count it was cooked at, so a later change to a lunch does not move it. A fridge meal's `cookServings` is its `servings`, and its `leftoversFor` is empty.

`extras` are the snacks, drinks and other items added to a day, outside its meals (HON-1311). `kind` is `ingredient` for a catalogue ingredient, with its name in the household's language, or `text` for free text. `quantity` is in `unit` (`g`, `ml` or `piece`); both are `null` when the extra has no amount, and always for `text`.

### `GET /api/v1/shopping-list`

What to buy for the planned meals, plus the staples the household marked ran out and the items it added by hand.

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
      "purchased": false,
      "restock": false
    }
  ],
  "customItems": [{ "id": "cm…", "name": "Candles", "checked": false, "neededBy": null }]
}
```

An item with `purchased: true` is already in the pantry. An item with `restock: true` is a staple the household marked ran out (HON-1398): its `neededBy` is today, and when no planned meal or extra needs it, it has no amount (`quantity` 0, `displayQuantity` empty). A custom item's `neededBy` is the earliest day, from today on, of a free-text day extra that put it on the list; it is `null` for an item typed by hand.

## Errors

Every error is `{ "error": "<a sentence for the developer>", "code": "<code>" }`.

| Status | `code`           | When                                                                                                        |
| ------ | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `400`  | `bad_request`    | A date that is not `YYYY-MM-DD`, `to` before `from`, more than 31 days, or `days` not 7 or 14               |
| `401`  | `invalid_key`    | No key, a malformed key, a revoked or expired key, or the key of an account waiting for deletion            |
| `403`  | `no_household`   | The account has no household: finish onboarding in Wobblepot first                                          |
| `429`  | `rate_limited`   | The household, or your network address, made too many requests. `Retry-After` says how many seconds to wait |
| `500`  | `internal_error` | Wobblepot could not answer. Try again later                                                                 |

## How often to poll

A household may make 120 requests an hour across all its keys. That limit is apart from an assistant's MCP limit, so a screen cannot use up the assistant's requests. One network address may also make 600 requests an hour, valid key or not.

Poll at most once a minute; every 5 minutes is enough for a meal plan. Home Assistant's REST sensor polls every 30 seconds unless you set `scan_interval`, which alone is 120 requests an hour, so always set it.

## Home Assistant example

Today's dinner, refreshed every 5 minutes. My account → Connections shows the same block, from `homeAssistantExample()` in `src/lib/api-keys-guide.ts`: change both together. Put the key in `secrets.yaml` as `wobblepot_api_key: "Bearer wp_…"`.

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
               | rejectattr('isSkipped')
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

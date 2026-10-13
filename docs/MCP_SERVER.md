# Wobblepot MCP server

Wobblepot runs a remote [MCP](https://modelcontextprotocol.io) server, so an AI assistant such as Claude can answer "what is for dinner tomorrow" or "do we need milk" from the household's own data (HON-1151). With the user's permission it can also update the shopping list, the pantry and the meal plan: "we bought the milk", "add dish soap to the list" (HON-1154), "swap Thursday's dinner", "that was good" (HON-1174). Every change it can make, the user can undo in the app.

Not to be confused with [MCP_SETUP.md](MCP_SETUP.md), which configures the MCP servers that agents working on this repository use.

## URL

| Environment       | MCP server URL                      |
| ----------------- | ----------------------------------- |
| Production        | `https://wobblepot.com/api/mcp`     |
| Staging           | `https://wobblepot.dev/api/mcp`     |
| Local development | `http://localhost:3000/api/mcp`     |
| Preview           | `https://<deployment host>/api/mcp` |

The resource identifier, the token audience and the URL are the same value: `getMcpResource(getServerBaseURL())` in `src/lib/mcp/oauth.ts`.

## Tools

Every tool has an `inputSchema` and an `outputSchema`, and the server lists every tool for every token. Each answers with compact JSON in a text block and the same object as `structuredContent`. Names of meals and ingredients follow the household's locale; dates are ISO `YYYY-MM-DD`; every `unit` is `g`, `ml` or `piece`, the unit the app shows.

| Tool                | Input                                                                                                      | Output                                                                                                                                                                                 | Reads through              |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `get_meal_plan`     | `from?`, `to?` (default: today to today + 6, household timezone; 31 days at most)                          | `{ from, to, entries: [{ date, mealType, mealId, mealName, servings, isCooked, isSkipped }] }`                                                                                         | `loadPlanEntries`          |
| `get_shopping_list` | `days`: 7 or 14 (default 7)                                                                                | `{ days, items: [{ ingredientId, name, quantity, unit, displayQuantity, category, neededBy, purchased }], customItems: [{ id, name, checked }] }`                                      | `loadShoppingList`         |
| `get_pantry`        | none                                                                                                       | `{ items: [{ ingredientId, name, quantity, unit, isStaple, neededSoon }] }`                                                                                                            | `loadPantry`               |
| `list_meals`        | `search?`, `mealType?`, `limit?` (≤ 50, default 20)                                                        | `{ total, meals: [{ id, name, mealTypes, proteinType, isFavorite, isOwnRecipe }] }`                                                                                                    | `loadMeals`                |
| `get_meal`          | `mealId`, `servings?` (default: the household's servings; pass an entry's `servings` from `get_meal_plan`) | `{ meal: { id, name, description, mealTypes, timeMinutes, servings, ingredients: [{ name, quantity, unit, note }], preparationNotes, nutritionPerServing, isOwnRecipe, isFavorite } }` | Prisma, `visibleMealWhere` |

### Read tools

These five carry `READ_ONLY_ANNOTATIONS`: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`. A token with `mcp:read` can call them.

### Write tools

These six need the `mcp:write` scope as well (HON-1154, HON-1173, HON-1174). They carry `WRITE_ANNOTATIONS` (`readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`); `add_shopping_item` and `swap_meal` set `idempotentHint: false`. Each calls the service function its app route calls, with the same field schemas, so the two paths cannot drift. No row records which member or assistant made a change, because the models have no such field.

| Tool                  | Input                                                                                 | Output                                                                                                                                                                                                            | Writes through, route                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mark_purchased`      | `ingredientIds` (1 to 100, from `get_shopping_list`), `purchased`                     | `{ purchased, items: [{ ingredientId, outcome }] }`; `outcome` is `in_pantry`, `removed`, `not_in_pantry`, `staple`, `too_old` or `has_quantity`                                                                  | `purchaseIngredients` (`POST /api/shopping-list/purchase`), `unpurchaseIngredient` (`POST /api/shopping-list/unpurchase`), in `src/lib/shopping/purchase.ts`                                                                                                                                             |
| `add_shopping_item`   | `name` (1 to 200 characters, trimmed)                                                 | `{ outcome, item: { id, name, checked } }`; `outcome` is `added`, `back_on_list` or `already_on_list`                                                                                                             | `addCustomShoppingItem` (`POST /api/shopping-list/custom`), in `src/lib/shopping/custom-items.ts`                                                                                                                                                                                                        |
| `check_shopping_item` | `id` (from `customItems` in `get_shopping_list`), `checked`                           | `{ item: { id, name, checked } }`                                                                                                                                                                                 | `updateCustomShoppingItem` (`PATCH /api/shopping-list/custom/[id]`), in `src/lib/shopping/custom-items.ts`                                                                                                                                                                                               |
| `set_pantry_quantity` | `ingredientId` (from `get_pantry` or `get_shopping_list`), `quantity` (≥ 0 or `null`) | `{ outcome, item: { ingredientId, name, quantity, unit, isStaple } }`; `outcome` is `created` or `updated`                                                                                                        | `createPantryItem` (`POST /api/pantry`), then `updatePantryItem` (`PATCH /api/pantry/[id]`) when the item exists, in `src/lib/pantry/pantry-items.ts`                                                                                                                                                    |
| `swap_meal`           | `date`, `mealType`, `mealId?` (from the suggestions; omit it to get them)             | `{ outcome, date, mealType, meal: { id, name } \| null, suggestions: [{ id, name, description, timeMinutes, kidFriendly, isOwnRecipe, householdRating }] }`; `outcome` is `suggestions`, `swapped` or `unchanged` | `loadSlotCandidates` and `suggestForSlot` (`POST …/entries/[entryId]/regenerate` and `/suggestions`), in `src/lib/meal-planning/slot-suggestions.ts`; `findSwapMeal`, `swapEntryData` and `writeSwappedEntry` (`PATCH /api/meal-plans/[id]/entries/[entryId]`), in `src/lib/meal-planning/swap-entry.ts` |
| `rate_meal`           | `date`, `mealType`, `rating` (`up`, `down` or `null` to clear)                        | `{ date, mealType, meal: { id, name }, rating }`                                                                                                                                                                  | The `rating` column write of `PATCH /api/meal-plans/[id]/entries/[entryId]`                                                                                                                                                                                                                              |

The pantry rules are the app's. Purchasing puts each ingredient in the pantry with an unknown quantity, in one transaction; an id that is not a global ingredient or the household's own refuses the whole call, so nothing is written. Undoing deletes the pantry item, but only a non-staple bought in the last 7 days. Unlike the app's undo, the tool also keeps a pantry item with a quantity above 0 (`keepWithQuantity`): a purchase always leaves the quantity unknown, so the quantity is one the household entered, and deleting it would lose data the app cannot restore. A purchase replaces a quantity the pantry item held, so undoing that purchase removes the item. A quantity of 0 ("ran out") is removed as before. The result names every item it left. Checking a custom item that is linked to an ingredient also puts that ingredient in the pantry. `set_pantry_quantity` sets the amount the household has: `0` means it ran out, `null` means "have some, amount unknown", and a negative is refused, as in both routes. It creates the pantry item when there is none (not a staple) and otherwise changes only its quantity, so a staple stays a staple. The quantity is in the `unit` `get_pantry` reports. The shopping list reads only an unknown quantity (`null`) as purchased, so setting `0` or an amount is never a purchase: an amount below what the plan needs keeps the rest on the list. Buying an item (`mark_purchased`, or checking a linked custom item) sets its quantity to `null`, replacing a `0` or an amount, so it drops off the list.

The meal plan tools find the entry by `date` and `mealType` in the household's own plan; a slot with no entry is refused, so neither tool adds a meal to an empty day. `swap_meal` without `mealId` changes nothing and returns the list the app shows for that slot: the `/regenerate` list (current meal left out, ranked by closeness to it) when the slot has a meal, the `/suggestions` list when its entry is empty. With `mealId`, the meal must be in the candidate pool those lists are the top 3 of: it suits the meal type, passes the household's dietary type, allergens and avoided ingredients, and is not planned anywhere from 14 days ago onward. Any other meal is refused with `isError` and nothing is written. The check is against the pool, not the top 3, because the top 3 has a fresh random tie-break on every request (HON-709) and would refuse a meal the tool had just offered. The write is the app's: tips, serving override and rating are reset, a skipped entry is planned again as the card does after a swap (HON-1125), and an entry that was cooked (`completed`) is never swapped, also when it was completed while the call ran. The meal already planned answers `unchanged`. The suggestions make no model call, so the tool counts only against the `mcp` limit, not the cost cap or the `meal-suggestions` bucket. `rate_meal` writes only the `rating` column, as the thumbs in the app do, and only on a cooked (`completed`) entry, the only place the app shows the thumbs, so the household can always see and clear what the assistant set. The write matches the entry's meal and status too, so a swap or a revert to planned that lands first does not take the rating with it.

**The scope check.** `runTool` (`src/lib/mcp/context.ts`) treats a tool as a write unless its annotations say `readOnlyHint: true`, so a tool that forgets its annotations is gated, not opened. A write tool called with a token that has no `mcp:write` answers `isError` with "This assistant can only read Wobblepot. To let it change the shopping list, pantry or meal plan, disconnect it and connect it again, then choose Allow." It runs nothing and is not counted against the rate limit. The tools are still listed for that token, so the model can tell the user what to do. `requireWriteScope(ctx)` is the check itself.

### Adding a tool

The tools live in `src/lib/mcp/tools/`, one file each, and `src/lib/mcp/server.ts` registers them. A new tool is a new file there plus one line in `MCP_TOOLS`. A write tool sets `annotations: WRITE_ANNOTATIONS` and calls the service its route calls; where the logic is inline in the route, move it to `src/lib/` first.

PostHog's MCP SDK adds a `context` argument (the agent's reason for the call), a `conversation_id` argument and an `llm_model` argument to every tool, and a small JSON block to results. That is expected; the SDK strips them before a tool runs.

## Protocol

Streamable HTTP, stateless: every `POST` builds a fresh server for that request (`createMcpHandler` from `@modelcontextprotocol/server`). It serves both protocol eras: the 2026-07-28 per-request envelope, and the 2025 `initialize` handshake (`legacy: 'stateless'`), because most clients still open with the second. `GET` answers 405, because no server-to-client stream exists. `OPTIONS` answers the CORS preflight; every response carries `Access-Control-Allow-Origin: *`, which is safe because the token is a bearer header and no cookie is read.

The server info (`mcpServerInfo(origin)` in `src/lib/mcp/server.ts`) carries `name: 'wobblepot'`, `title`, `version`, a one-sentence `description`, `websiteUrl` (the origin) and `icons`: `/icons/icon-192x192.png` and `/icons/icon-512x512.png` as absolute URLs on the origin. Claude shows the icon in its connector list; without it, Claude looks the host up in a third-party favicon cache, which can hold an old icon for weeks (HON-1171). Keep `name` and `version` fixed: `@posthog/mcp` reports them as `$mcp_server_name` and `$mcp_server_version`.

## Auth flow

1. The client calls `/api/mcp` without a token and gets 401 with `WWW-Authenticate` pointing at `/.well-known/oauth-protected-resource/api/mcp`.
2. It reads that metadata and the authorization server's at `/.well-known/oauth-authorization-server`, then registers (dynamic registration or a Client ID Metadata Document).
3. The user signs in to Wobblepot and allows the client on `/consent`. The page lists each requested scope in plain words; `mcp:write` reads "Update your shopping list, pantry and meal plan." The user allows all the requested scopes or none.
4. The client exchanges the code (PKCE `S256`) for a 1-hour JWT access token bound to `<origin>/api/mcp`, plus a refresh token with `offline_access`.
5. Each `POST /api/mcp` carries `Authorization: Bearer <token>`; `requireMcpAuth` checks it against `/api/auth/jwks`.

The authorization server is in [SECURITY.md](SECURITY.md) → OAuth for MCP clients.

**Scopes.** `mcp:read` is required for every request (`requiredScopes` in the route); `mcp:write` adds the write tools. Both are in `MCP_SCOPES` (`src/lib/mcp/oauth.ts`), in the protected-resource metadata and in the 401 challenge (`challengeScopes`), so a client such as Claude asks for both. The challenge matters most: a client reads its `scope` before `scopes_supported`, and without `challengeScopes` it would say `mcp:read` only. A connection made before HON-1154 holds `mcp:read` only, and its refresh token cannot widen that: the user disconnects and connects again to allow changes.

**Adding a scope** takes two more steps than editing `MCP_SCOPES`, because the plugin stores scope lists in two places:

- Every registered client stores the server's scope list on its `oauth_client` row, and the authorize endpoint refuses a scope outside it with `invalid_scope`. A migration must add the scope to the existing rows (`20261013120000_add_mcp_write_scope`), or every client registered before the change fails as soon as it asks for the new scope.
- The `oauth_resource` row's `allowedScopes` narrows every token for `/api/mcp`. `resourceSeedMode: 'merge'` in `src/lib/auth.ts` rewrites it from config on each start. The default, `insertOnly`, never updates an existing row, so the new scope would be dropped from every token without an error.

## Connecting and disconnecting

The profile page has a "Connect to an AI assistant" section (HON-1153): the server URL with Copy, three steps for Claude's custom connectors with a link to Anthropic's guide, and the "Connected assistants" list. The list is the user's `oauth_consent` rows (`GET /api/auth/user/mcp-consents`, `listMcpConsents` in `src/lib/mcp/consents.ts`).

**Disconnecting.** Disconnect calls `DELETE /api/auth/user/mcp-consents/[clientId]`, which deletes the user's `oauth_consent`, `oauth_refresh_token` and `oauth_access_token` rows for that client in one transaction (`disconnectMcpClient`). The plugin's own `/oauth2/delete-consent` deletes only the consent row, so it is not used. The access token is a JWT that is not stored, so deleting rows alone would leave it valid for up to an hour: `/api/mcp` therefore refuses a token whose `sub` and `azp` (the client id) have no consent row, with the same 401 `invalid_token` challenge as a deleted account. It also refuses a token whose `iat` is before the consent row's `createdAt`, so reconnecting the same assistant within the hour does not bring back a token issued before Disconnect. The assistant's next call fails, and it must ask the user to connect again. Another user's client id gets 404, so the route does not confirm that someone else's grant exists. Account deletion disconnects every assistant the same way (`docs/RUNBOOKS/gdpr-deletion.md`).

## Test locally with MCP Inspector

1. Run the app: `pnpm dev`.
2. Run the inspector: `npx @modelcontextprotocol/inspector`.
3. In the inspector, choose transport **Streamable HTTP**, URL `http://localhost:3000/api/mcp`, and connect. It follows the 401 into the OAuth flow, opens Wobblepot's sign-in and consent pages, and lists the five tools once you allow it.
4. Call `get_meal_plan` with no arguments to see this week.

To call it by hand, take an access token from the inspector and send a 2025-era request (no envelope needed):

```bash
curl -s http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

`tests/e2e/mcp-read.spec.ts` drives the same flow in CI; `tests/e2e/mcp-write.spec.ts` connects with `mcp:write` and runs `mark_purchased`.

## Limits and errors

- **Rate limit.** 120 tool calls per hour per household (`mcp` in `src/lib/rate-limit.ts`), reads and writes together. `tools/list` is not counted. Over the limit, a tool answers `isError` with the reset time.
- **No household.** An account that has not finished onboarding gets `isError` with "This account has no household yet. Finish onboarding in Wobblepot first." from every tool.
- **No write scope.** A write tool called without `mcp:write` answers `isError` with the reconnect sentence (see Write tools).
- **Refusals** (an unknown meal id, a date range the wrong way round, an ingredient id that is not on the household's list) answer `isError` with a plain sentence.
- **Failures.** A tool that throws answers `isError` with "Wobblepot could not complete this request. Try again later." and reports the real error once through `captureApiError` (`src/lib/mcp/context.ts` → `runTool`). The server's error text never reaches the client.
- **CSP.** `src/proxy.ts` adds its Content Security Policy to this route as to every route. It is a header on a JSON response, which runs no script, and MCP clients do not apply it to a `fetch`, so it needs no exception.

## Analytics

`@posthog/mcp` wraps each request's server (`src/lib/mcp/analytics.ts`) and sends `$mcp_tool_call` per call and `$mcp_tools_list`, through `getPosthogMcpServer()`: a client of its own with the shared client's options, because `instrument` rewrites the library id (`$lib`) of the client it is given. Events are on the user's person (the token's `sub`) and carry `household_id`. A `beforeSend` removes `$mcp_parameters` and `$mcp_response`, so no search string, meal or pantry content reaches PostHog; `$mcp_intent`, the agent's reason, stays in full by decision; the sanitiser does not shorten `$`-prefixed keys. The SDK's exception capture is off: with SDK 2.x it only sees the error result, not the thrown error, so `runTool` reports failures instead. PostHog shows the results under MCP analytics.

The connect funnel is `mcp:server_url_copied` (Copy on the profile page, a client event, so the cookie banner gates it) → `mcp:client_connected` (Allow on `/consent`) → the first `$mcp_tool_call`. Disconnect captures `mcp:client_disconnected`. All three are listed in `src/lib/analytics.ts`.

The tool-call capture is server-side, so the cookie banner does not gate it, the same as `$ai_generation`. The consent page says what each event holds (the tool, its timing and the assistant's reason) and that the data the tool read is not recorded.

## Threat model

A token reaches one household's data and nothing else. It needs the `mcp:read` scope, is bound to this resource by audience and to one user by `sub`, and expires within an hour; a deleted account's token, and a token whose client the user disconnected, is refused even before it expires. The route resolves the household from `sub` on every request with `getHouseholdMembership`, the call every API route makes, and each tool reads and writes only through that household's id (`get_meal` limits itself to the shared catalogue and the household's own recipes with `visibleMealWhere`; a write tool refuses another household's ingredient or item id as unknown, so it does not reveal that the id exists). A write needs `mcp:write`, which the user allowed on `/consent` after reading "Update your shopping list, pantry and meal plan." The write tools change only the shopping list, the pantry and the meal plan; none deletes what the app cannot restore, and the user can undo each change in the app. A swap clears the entry's rating, tips and serving override, as the app's swap does. A confused or compromised client with write access can therefore mark items bought, add items, set a pantry quantity, or swap a planned meal (only to a meal that fits the household's diet and allergens) or rate a cooked one, within the shared rate limit of 120 calls an hour, but cannot delete a recipe, change members or preferences, or spend money: no tool calls an AI model. Tool parameters and results stay out of analytics. What the assistant does with the data it reads is up to its own provider: it is a third party the user chooses, not our processor. The privacy policy says so (`/privacy#ai-assistants`), and the DPIA assesses it as risk area 3 (`compliance/dpia.md`, HON-1161).

## Not yet

No tool adds a meal to a day with no entry. AI tools such as plan generation are not planned yet: they cost money per call and need a per-household budget.

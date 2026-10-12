# Wobblepot MCP server

Wobblepot runs a remote [MCP](https://modelcontextprotocol.io) server, so an AI assistant such as Claude can answer "what is for dinner tomorrow" or "do we need milk" from the household's own data. This first version only reads (HON-1151). No tool changes data, so a wrong answer from the assistant cannot damage a plan.

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

All five carry `readOnlyHint: true`, `destructiveHint: false` and `openWorldHint: false`, an `inputSchema` and an `outputSchema`. Each answers with compact JSON in a text block and the same object as `structuredContent`. Names of meals and ingredients follow the household's locale; dates are ISO `YYYY-MM-DD`; every `unit` is `g`, `ml` or `piece`, the unit the app shows.

| Tool                | Input                                                                                                      | Output                                                                                                                                                                                 | Reads through              |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `get_meal_plan`     | `from?`, `to?` (default: today to today + 6, household timezone; 31 days at most)                          | `{ from, to, entries: [{ date, mealType, mealId, mealName, servings, isCooked, isSkipped }] }`                                                                                         | `loadPlanEntries`          |
| `get_shopping_list` | `days`: 7 or 14 (default 7)                                                                                | `{ days, items: [{ ingredientId, name, quantity, unit, displayQuantity, category, neededBy, purchased }], customItems: [{ id, name, checked }] }`                                      | `loadShoppingList`         |
| `get_pantry`        | none                                                                                                       | `{ items: [{ ingredientId, name, quantity, unit, isStaple, neededSoon }] }`                                                                                                            | `loadPantry`               |
| `list_meals`        | `search?`, `mealType?`, `limit?` (≤ 50, default 20)                                                        | `{ total, meals: [{ id, name, mealTypes, proteinType, isFavorite, isOwnRecipe }] }`                                                                                                    | `loadMeals`                |
| `get_meal`          | `mealId`, `servings?` (default: the household's servings; pass an entry's `servings` from `get_meal_plan`) | `{ meal: { id, name, description, mealTypes, timeMinutes, servings, ingredients: [{ name, quantity, unit, note }], preparationNotes, nutritionPerServing, isOwnRecipe, isFavorite } }` | Prisma, `visibleMealWhere` |

The tools live in `src/lib/mcp/tools/`, one file each, and `src/lib/mcp/server.ts` registers them. A new tool is a new file there plus one line in `MCP_TOOLS`.

PostHog's MCP SDK adds a `context` argument (the agent's reason for the call), a `conversation_id` argument and an `llm_model` argument to every tool, and a small JSON block to results. That is expected; the SDK strips them before a tool runs.

## Protocol

Streamable HTTP, stateless: every `POST` builds a fresh server for that request (`createMcpHandler` from `@modelcontextprotocol/server`). It serves both protocol eras: the 2026-07-28 per-request envelope, and the 2025 `initialize` handshake (`legacy: 'stateless'`), because most clients still open with the second. `GET` answers 405, because no server-to-client stream exists. `OPTIONS` answers the CORS preflight; every response carries `Access-Control-Allow-Origin: *`, which is safe because the token is a bearer header and no cookie is read.

The server info (`mcpServerInfo(origin)` in `src/lib/mcp/server.ts`) carries `name: 'wobblepot'`, `title`, `version`, a one-sentence `description`, `websiteUrl` (the origin) and `icons`: `/icons/icon-192x192.png` and `/icons/icon-512x512.png` as absolute URLs on the origin. Claude shows the icon in its connector list; without it, Claude looks the host up in a third-party favicon cache, which can hold an old icon for weeks (HON-1171). Keep `name` and `version` fixed: `@posthog/mcp` reports them as `$mcp_server_name` and `$mcp_server_version`.

## Auth flow

1. The client calls `/api/mcp` without a token and gets 401 with `WWW-Authenticate` pointing at `/.well-known/oauth-protected-resource/api/mcp`.
2. It reads that metadata and the authorization server's at `/.well-known/oauth-authorization-server`, then registers (dynamic registration or a Client ID Metadata Document).
3. The user signs in to Wobblepot and allows the client on `/consent`.
4. The client exchanges the code (PKCE `S256`) for a 1-hour JWT access token bound to `<origin>/api/mcp`, plus a refresh token with `offline_access`.
5. Each `POST /api/mcp` carries `Authorization: Bearer <token>`; `requireMcpAuth` checks it against `/api/auth/jwks`.

The authorization server is in [SECURITY.md](SECURITY.md) → OAuth for MCP clients.

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

`tests/e2e/mcp-read.spec.ts` drives the same flow in CI.

## Limits and errors

- **Rate limit.** 120 tool calls per hour per household (`mcp` in `src/lib/rate-limit.ts`). `tools/list` is not counted. Over the limit, a tool answers `isError` with the reset time.
- **No household.** An account that has not finished onboarding gets `isError` with "This account has no household yet. Finish onboarding in Wobblepot first." from every tool.
- **Refusals** (an unknown meal id, a date range the wrong way round) answer `isError` with a plain sentence.
- **Failures.** A tool that throws answers `isError` with "Wobblepot could not read this data. Try again later." and reports the real error once through `captureApiError` (`src/lib/mcp/context.ts` → `runTool`). The server's error text never reaches the client.
- **CSP.** `src/proxy.ts` adds its Content Security Policy to this route as to every route. It is a header on a JSON response, which runs no script, and MCP clients do not apply it to a `fetch`, so it needs no exception.

## Analytics

`@posthog/mcp` wraps each request's server (`src/lib/mcp/analytics.ts`) and sends `$mcp_tool_call` per call and `$mcp_tools_list`, through `getPosthogMcpServer()`: a client of its own with the shared client's options, because `instrument` rewrites the library id (`$lib`) of the client it is given. Events are on the user's person (the token's `sub`) and carry `household_id`. A `beforeSend` removes `$mcp_parameters` and `$mcp_response`, so no search string, meal or pantry content reaches PostHog; `$mcp_intent`, the agent's reason, stays in full by decision; the sanitiser does not shorten `$`-prefixed keys. The SDK's exception capture is off: with SDK 2.x it only sees the error result, not the thrown error, so `runTool` reports failures instead. PostHog shows the results under MCP analytics.

The connect funnel is `mcp:server_url_copied` (Copy on the profile page, a client event, so the cookie banner gates it) → `mcp:client_connected` (Allow on `/consent`) → the first `$mcp_tool_call`. Disconnect captures `mcp:client_disconnected`. All three are listed in `src/lib/analytics.ts`.

The tool-call capture is server-side, so the cookie banner does not gate it, the same as `$ai_generation`. The consent page says what each event holds (the tool, its timing and the assistant's reason) and that the data the tool read is not recorded.

## Threat model

A token reads one household's data and nothing else. It needs the `mcp:read` scope, is bound to this resource by audience and to one user by `sub`, and expires within an hour; a deleted account's token, and a token whose client the user disconnected, is refused even before it expires. The route resolves the household from `sub` on every request with `getHouseholdMembership`, the call every API route makes, and each tool reads only through that household's id (`get_meal` limits itself to the shared catalogue and the household's own recipes with `visibleMealWhere`). No tool writes, and no tool calls an AI model, so a compromised or confused client can read what the user allowed but cannot change a plan or spend money. Tool parameters and results stay out of analytics. What the assistant does with the data it reads is up to its own provider: it is a third party the user chooses, not our processor. The privacy policy says so (`/privacy#ai-assistants`), and the DPIA assesses it as risk area 3 (`compliance/dpia.md`, HON-1161).

## Not yet

Write tools (HON-1154) and AI tools such as plan generation.

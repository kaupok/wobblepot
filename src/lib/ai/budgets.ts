/**
 * Wall-clock budgets for the app's AI calls, in milliseconds.
 *
 * Each budget is shared by the initial attempt and every `maxRetries` retry
 * rather than being a per-attempt timeout, which makes it the real bound on
 * retries — a fast failure (429, 5xx) costs well under a second and still
 * retries freely; a slow generation does not.
 *
 * Every route that spends one of these declares `maxDuration = 60`, and each
 * budget leaves headroom under that for the route's own DB and network work so
 * its 504 stays reachable instead of the platform killing the function first.
 * `budgets.test.ts` holds every value under 60 000.
 *
 * These lived beside each route's `maxDuration` until HON-796 (HON-694 had put
 * them there). A route file cannot export them and cannot load outside Next.js,
 * so the model benchmark (HON-795) had nothing to compare measured latency
 * against. This module is pure: no Prisma, no env, no `next/*`.
 *
 * Sized against the figures recorded on Sonnet 5 during HON-693: preparation
 * tips 15-21s, quantity review 25-32s, both on deliberately hard inputs.
 */

/**
 * `/api/meal-plans/generate`, both modes. One budget, not one per call site:
 * `mode` is an enum and each branch returns, so `generateMealPlan` and
 * `fillEmptySlots` are mutually exclusive and exactly one of them runs.
 *
 * Plan generation is the app's largest generation, so assume worse than the
 * 25-32s anchor; 40s covers a worst-case attempt with room for the fast
 * failures above.
 *
 * Passed as a duration, not a ready-made signal: this route's DB prelude runs
 * *inside* `generateMealPlan` / `fillEmptySlots` (the kept-slot read, the
 * parallel history/favourite/pantry fetch, `loadCandidatePools`, and for
 * fill-empty a nested plan `findUnique`), so a signal started in the route
 * would spend the AI budget on queries. The lib starts the clock immediately
 * before the model call instead. That leaves the 20s under `maxDuration` for
 * the prelude plus `hydratePlan` and the bulk entry write afterwards — more
 * than the 15s the tips route reserves, because this route's DB work is the
 * heaviest in the app.
 */
export const PLAN_AI_BUDGET_MS = 40_000

/**
 * `/api/recipes/parse`, pasted text. Recipe extraction is the quantity-review
 * shape, so it wants the full 45s the tips route uses — and on pasted text it
 * gets it, leaving 15s under `maxDuration` for ingredient matching and the
 * response. The signal is created *after* any fetch, so network time is spent
 * from the ceiling, never from the model budget.
 */
export const RECIPE_PARSE_AI_BUDGET_MS = 45_000

/**
 * `/api/recipes/parse`, after a URL fetch. A URL import cannot afford the
 * pasted-text budget. `fetchRecipeFromUrl` runs two sequential network calls
 * before returning any text: `checkRobotsAllowed`, up to 5s on a cache miss
 * (`ROBOTS_FETCH_TIMEOUT_MS`, `src/lib/robots.ts`), and then the page itself,
 * up to 15s (`AbortSignal.timeout(15000)`, `recipe-fetch.ts`). Worst case that
 * is 20s gone before the model starts, so the budget drops to 30s: 20 + 30 =
 * 50s, the same 10s of slack the other two routes keep. A single 45s constant
 * would put the worst case at 65s — past the ceiling, so the platform would
 * kill the function and the route's 504 would never run.
 */
export const RECIPE_PARSE_AFTER_URL_FETCH_AI_BUDGET_MS = 30_000

/**
 * `/api/meals/imagine`. Imagine is the quantity-review shape, but it also
 * accepts photos, which add input tokens and latency — so it is sized above
 * that anchor rather than at it. The remaining 20s under `maxDuration` covers
 * base64-decoding up to `MAX_ATTACHED_IMAGES` before the call and the three
 * parallel `matchIngredients` passes plus nutrition reads after it.
 */
export const IMAGINE_AI_BUDGET_MS = 40_000

/**
 * `/api/meals/imagine/review`. This route *is* the quantity review, so 45s is
 * ~1.4x its own measured upper bound — no extrapolation from a neighbouring
 * call site is involved.
 *
 * The remaining 15s under `maxDuration` covers the session read, the
 * membership lookup and `assertUnderCap` before the call and the usage write
 * after it. That is the same headroom the preparation-tips route reserves, and
 * less than imagine's 20s: this route runs no ingredient matching and no
 * nutrition reads, so its non-AI work is the lightest of the AI routes.
 */
export const REVIEW_AI_BUDGET_MS = 45_000

/**
 * `/api/meal-plans/[id]/entries/[entryId]/preparation-tips`. One budget for
 * all AI time in the request. `maxRetries: 3` permits four attempts, but how
 * many actually fit depends on how each one fails.
 *
 * Sonnet 5's adaptive thinking made a single hard-meal generation take up to
 * 21s (measured, HON-693), so at the old 30s a slow first attempt left no room
 * for even one retry — the call aborted and the user got a 504 instead of the
 * tips the larger token ceilings were meant to buy. 45s covers two worst-case
 * attempts plus ai@7's ~2s backoff (~45s), and leaves 15s under the 60s
 * `maxDuration` for the DB reads before the call and the writes after it.
 */
export const TIPS_AI_BUDGET_MS = 45_000

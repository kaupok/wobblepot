/**
 * Machine-readable error codes for the two AI surfaces whose failures reach a
 * user-facing string: `/api/meals/imagine` and `/api/recipes/parse`.
 *
 * The routes send a `code` alongside the existing `error` prose; the clients
 * map the code to a message key and render the translation. `error` stays in
 * the body for logs and breadcrumbs — it is English on every branch, so it must
 * never be what an Estonian household reads (HON-700).
 *
 * Deliberately free of `server-only` and of any Next.js import: the route
 * handlers and the client components both import from here, which is what keeps
 * the two halves of the contract from drifting apart.
 */

/** Error codes returned by `POST /api/meals/imagine`. */
export type ImagineErrorCode =
  | 'unauthorized'
  | 'no_household'
  | 'rate_limited'
  | 'ai_cap_exceeded'
  | 'prompt_too_long'
  | 'too_many_images'
  | 'wrong_image_type'
  | 'image_too_large'
  | 'prompt_or_photo_required'
  | 'prompt_required'
  | 'invalid_request'
  | 'imagine_timeout'
  | 'imagine_failed'

/** Error codes returned by `POST /api/recipes/parse`. */
export type RecipeImportErrorCode =
  | 'unauthorized'
  | 'no_household'
  | 'rate_limited'
  | 'ai_cap_exceeded'
  | 'import_disabled'
  | 'invalid_request'
  | 'url_not_allowed'
  | 'robots_disallowed'
  | 'url_fetch_failed'
  | 'url_not_a_page'
  | 'url_content_too_short'
  | 'text_too_short'
  | 'no_recipe_found'
  | 'no_ingredients_found'
  | 'low_confidence'
  | 'parse_timeout'
  | 'parse_failed'

/**
 * The subset of `RecipeImportErrorCode` a `RecipeParseError` can carry. The
 * route maps these to a status: `robots_disallowed` is a 403, the rest are
 * 400s.
 */
export type RecipeParseErrorCode = Extract<
  RecipeImportErrorCode,
  | 'url_not_allowed'
  | 'robots_disallowed'
  | 'url_fetch_failed'
  | 'url_not_a_page'
  | 'url_content_too_short'
  | 'text_too_short'
  | 'no_recipe_found'
  | 'no_ingredients_found'
  | 'low_confidence'
  | 'parse_failed'
>

/**
 * `ImagineErrorCode` → message key under `recipes.imagine.errors`.
 *
 * `ImaginePanel` keeps its own copy in `meal-plan.selector.imagine` but reads
 * these strings from `recipes.imagine.errors` too, rather than duplicating
 * thirteen error messages into a second namespace.
 */
export const IMAGINE_ERROR_KEYS = {
  unauthorized: 'unauthorized',
  no_household: 'noHousehold',
  rate_limited: 'rateLimited',
  ai_cap_exceeded: 'aiCapExceeded',
  prompt_too_long: 'promptTooLong',
  too_many_images: 'tooManyImages',
  wrong_image_type: 'wrongImageType',
  image_too_large: 'imageTooLarge',
  prompt_or_photo_required: 'promptOrPhotoRequired',
  prompt_required: 'promptRequired',
  invalid_request: 'invalidRequest',
  imagine_timeout: 'imagineTimeout',
  imagine_failed: 'imagineFailed',
} as const satisfies Record<ImagineErrorCode, string>

/** `RecipeImportErrorCode` → message key under `recipes.import.errors`. */
export const RECIPE_IMPORT_ERROR_KEYS = {
  unauthorized: 'unauthorized',
  no_household: 'noHousehold',
  rate_limited: 'rateLimited',
  ai_cap_exceeded: 'aiCapExceeded',
  import_disabled: 'importDisabled',
  invalid_request: 'invalidRequest',
  url_not_allowed: 'urlNotAllowed',
  robots_disallowed: 'robotsDisallowed',
  url_fetch_failed: 'urlFetchFailed',
  url_not_a_page: 'urlNotAPage',
  url_content_too_short: 'urlContentTooShort',
  text_too_short: 'textTooShort',
  no_recipe_found: 'noRecipeFound',
  no_ingredients_found: 'noIngredientsFound',
  low_confidence: 'lowConfidence',
  parse_timeout: 'parseTimeout',
  // `parseGeneric`, not `parseFailed`: this covers the 500 and the
  // AI-generation catch-all, whose prose explicitly told the user to retry.
  // It also matches the network-failure path in the same component, which
  // would otherwise give better guidance than the server does.
  parse_failed: 'parseGeneric',
} as const satisfies Record<RecipeImportErrorCode, string>

/**
 * Resolve the message key for a `code` off the wire, falling back when the
 * code is missing, not a string, or one this build does not know — a response
 * from a newer deploy, or a proxy-generated body with no `code` at all.
 *
 * Returns the key rather than the translated string so the caller keeps
 * control of which `useTranslations` namespace it resolves against.
 */
export function translateErrorCode(
  code: unknown,
  keys: Record<string, string>,
  fallbackKey: string,
): string {
  if (typeof code !== 'string') return fallbackKey
  // `Object.hasOwn`, not a bare lookup: `keys['toString']` would otherwise
  // resolve to `Object.prototype.toString` and be handed to `t()` as a key.
  if (!Object.hasOwn(keys, code)) return fallbackKey
  const key = keys[code]
  return typeof key === 'string' ? key : fallbackKey
}

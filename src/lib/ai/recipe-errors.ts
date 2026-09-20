import type { RecipeParseErrorCode } from './error-codes'

/**
 * Error thrown when recipe parsing fails due to insufficient content.
 *
 * `code` travels with the throw because `/api/recipes/parse` catches every
 * throw site in a single branch: without it, eleven distinct failures collapse
 * into one message and the client cannot tell "that site blocks importing"
 * from "that text is too short" (HON-700). It also picks the status — the
 * route answers 403 for `robots_disallowed` and 400 for the rest.
 */
export class RecipeParseError extends Error {
  readonly code: RecipeParseErrorCode

  constructor(message: string, code: RecipeParseErrorCode = 'parse_failed') {
    super(message)
    this.name = 'RecipeParseError'
    this.code = code
  }
}

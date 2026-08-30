/**
 * Error thrown when recipe parsing fails due to insufficient content.
 */
export class RecipeParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecipeParseError'
  }
}

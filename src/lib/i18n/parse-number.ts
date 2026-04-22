export interface ParseLocalizedNumberOptions {
  integer?: boolean
  locale?: string
}

/**
 * Parse a user-typed numeric string that may use either `.` or `,` as the
 * decimal separator. Returns `null` for anything that isn't a clean number.
 *
 * Why both separators in every locale: Estonian partners type `1,5`,
 * English partners type `1.5`, and users routinely paste values between
 * contexts. Accepting both is less surprising than rejecting one in each
 * locale — especially since meal-planning quantities never use thousands
 * separators, so there's no `1,000` ambiguity to resolve.
 *
 * Rejects: empty/whitespace, strings with both `.` and `,`, multiple of the
 * same separator, scientific notation (`1e5`), non-numeric characters,
 * trailing/leading separators (`1,`, `,5`).
 *
 * The `locale` option is accepted for forward-compatibility with HON-499 /
 * HON-511 locale threading but is currently unused — behaviour is locale-
 * independent.
 */
export function parseLocalizedNumber(
  input: string,
  options: ParseLocalizedNumberOptions = {},
): number | null {
  if (typeof input !== 'string') return null

  const trimmed = input.trim()
  if (trimmed === '') return null

  const hasDot = trimmed.includes('.')
  const hasComma = trimmed.includes(',')
  if (hasDot && hasComma) return null

  const normalized = hasComma ? trimmed.replace(',', '.') : trimmed

  // Strict numeric shape: optional leading `-`, digits, optional `.digits`.
  // Rejects scientific notation, hex, leading `+`, trailing separators,
  // internal whitespace, and anything with non-numeric characters.
  const pattern = options.integer ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/
  if (!pattern.test(normalized)) return null

  const value = Number(normalized)
  if (!Number.isFinite(value)) return null

  return value
}

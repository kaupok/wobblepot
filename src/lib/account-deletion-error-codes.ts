/**
 * Machine-readable error codes for `DELETE /api/auth/user` (HON-725).
 *
 * Same contract as `src/lib/ai/error-codes.ts`: the route sends a `code`
 * alongside its English `message`, and `DeleteAccountDialog` maps the code to a
 * key under `profile.delete.errors`. Free of `server-only` so both halves can
 * import it.
 */

export type AccountDeletionErrorCode = 'unauthorized' | 'sole_owner' | 'delete_failed'

/** `AccountDeletionErrorCode` → message key under `profile.delete.errors`. */
export const ACCOUNT_DELETION_ERROR_KEYS = {
  unauthorized: 'unauthorized',
  sole_owner: 'soleOwner',
  delete_failed: 'deleteFailed',
} as const satisfies Record<AccountDeletionErrorCode, string>

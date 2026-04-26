/**
 * Auth-error keyword matcher.
 *
 * Better Auth surfaces server-side errors as English strings inside the
 * `onError` callback. We map those strings to a stable error key so the
 * UI layer can render a localized, user-friendly message via
 * `useAuthErrorMessage()` (see `auth-errors-client.tsx`).
 *
 * This module is pure — no React, no i18n — so the keyword ladder stays
 * unit-testable and importable from server code if needed.
 */

export type AuthErrorKey =
  | 'inviteCodeRequired'
  | 'inviteCodeInvalid'
  | 'invalidCredentials'
  | 'incorrectPassword'
  | 'accountAlreadyExists'
  | 'csrf'
  | 'tokenExpired'
  | 'tokenInvalid'
  | 'resetUserNotFound'
  | 'userNotFound'
  | 'invalidEmail'
  | 'breachedPassword'
  | 'passwordTooShort'
  | 'passwordWeak'
  | 'tooManyAttempts'
  | 'network'
  | 'timeout'
  | 'internalServer'
  | 'serviceUnavailable'

/**
 * Match a raw server error message against the known catalogue of auth
 * failures. Returns the key for `errors.auth.<key>` in the message catalog,
 * or `null` if no mapping applies (caller should fall back to the raw string
 * — typically a developer-facing error that survives all UI mappings).
 *
 * Empty input → `null` (caller renders the generic "unexpected" copy).
 */
export function getAuthErrorKey(message: string): AuthErrorKey | null {
  if (!message) {
    return null
  }

  const lowerMessage = message.toLowerCase()

  // Invite-code errors (must come before the CSRF/forbidden branch — the
  // backend throws these as APIError('FORBIDDEN', ...) and the keyword
  // 'forbidden' would otherwise swallow them into the generic CSRF copy).
  if (lowerMessage.includes('invite code is required')) {
    return 'inviteCodeRequired'
  }
  if (lowerMessage.includes('invite code') && lowerMessage.includes('invalid')) {
    return 'inviteCodeInvalid'
  }

  // Authentication errors
  if (lowerMessage.includes('invalid') && lowerMessage.includes('credentials')) {
    return 'invalidCredentials'
  }
  if (lowerMessage.includes('password') && lowerMessage.includes('incorrect')) {
    return 'incorrectPassword'
  }

  // Account existence errors
  if (lowerMessage.includes('already exists') || lowerMessage.includes('already registered')) {
    return 'accountAlreadyExists'
  }

  // Security errors (must come before password reset token checks to avoid false matches)
  if (lowerMessage.includes('csrf') || lowerMessage.includes('forbidden')) {
    return 'csrf'
  }

  // Password reset errors (must come before generic user not found check)
  if (lowerMessage.includes('token') && lowerMessage.includes('expired')) {
    return 'tokenExpired'
  }
  if (lowerMessage.includes('token') && lowerMessage.includes('invalid')) {
    return 'tokenInvalid'
  }
  if (
    (lowerMessage.includes('email not found') ||
      lowerMessage.includes('user not found') ||
      lowerMessage.includes('no user')) &&
    lowerMessage.includes('reset')
  ) {
    return 'resetUserNotFound'
  }

  // Generic user not found (must come after password reset check)
  if (lowerMessage.includes('user not found') || lowerMessage.includes('no user')) {
    return 'userNotFound'
  }

  // Validation errors
  // Note: "invalid email or password" is handled by credentials check above
  // This only matches standalone email validation errors
  if (lowerMessage.includes('invalid email') && !lowerMessage.includes('password')) {
    return 'invalidEmail'
  }
  // Breached-password check (must come before generic "password weak" / "password short")
  if (
    lowerMessage.includes('compromised') ||
    lowerMessage.includes('data breach') ||
    lowerMessage.includes('breached') ||
    lowerMessage.includes('pwned')
  ) {
    return 'breachedPassword'
  }
  if (
    lowerMessage.includes('password') &&
    (lowerMessage.includes('short') || lowerMessage.includes('minimum'))
  ) {
    return 'passwordTooShort'
  }
  if (lowerMessage.includes('password') && lowerMessage.includes('weak')) {
    return 'passwordWeak'
  }

  // Rate limiting
  if (lowerMessage.includes('too many')) {
    return 'tooManyAttempts'
  }

  // Network errors
  if (lowerMessage.includes('network') || lowerMessage.includes('fetch failed')) {
    return 'network'
  }
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return 'timeout'
  }

  // Server errors
  if (lowerMessage.includes('internal server') || lowerMessage.includes('500')) {
    return 'internalServer'
  }
  if (lowerMessage.includes('service unavailable') || lowerMessage.includes('503')) {
    return 'serviceUnavailable'
  }

  return null
}

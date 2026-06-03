import { describe, it, expect } from 'vitest'
import { getAuthErrorKey } from './auth-errors'

describe('getAuthErrorKey', () => {
  describe('authentication errors', () => {
    it('handles invalid credentials error', () => {
      expect(getAuthErrorKey('Invalid credentials')).toBe('invalidCredentials')
      expect(getAuthErrorKey('invalid credentials provided')).toBe('invalidCredentials')
    })

    it('handles user not found error', () => {
      expect(getAuthErrorKey('User not found')).toBe('userNotFound')
      expect(getAuthErrorKey('No user exists')).toBe('userNotFound')
    })

    it('handles incorrect password error', () => {
      expect(getAuthErrorKey('Password incorrect')).toBe('incorrectPassword')
      expect(getAuthErrorKey('Incorrect password provided')).toBe('incorrectPassword')
    })
  })

  describe('account existence errors', () => {
    it('handles account already exists error', () => {
      expect(getAuthErrorKey('User already exists')).toBe('accountAlreadyExists')
      expect(getAuthErrorKey('Email already registered')).toBe('accountAlreadyExists')
    })
  })

  describe('validation errors', () => {
    it('handles invalid email error', () => {
      expect(getAuthErrorKey('Invalid email format')).toBe('invalidEmail')
      expect(getAuthErrorKey('Invalid email address')).toBe('invalidEmail')
    })

    it('handles password too short error', () => {
      expect(getAuthErrorKey('Password too short')).toBe('passwordTooShort')
      expect(getAuthErrorKey('Password minimum length not met')).toBe('passwordTooShort')
    })

    it('handles weak password error', () => {
      expect(getAuthErrorKey('Password is too weak')).toBe('passwordWeak')
      expect(getAuthErrorKey('Weak password provided')).toBe('passwordWeak')
    })

    it('handles breached/compromised password error', () => {
      expect(
        getAuthErrorKey(
          'That password appears in known data breaches. Please pick a different one.',
        ),
      ).toBe('breachedPassword')
      expect(getAuthErrorKey('The password you entered has been compromised.')).toBe(
        'breachedPassword',
      )
      expect(getAuthErrorKey('Password found in data breach')).toBe('breachedPassword')
      expect(getAuthErrorKey('This password is pwned')).toBe('breachedPassword')
    })
  })

  describe('rate limiting errors', () => {
    it('handles too many attempts error', () => {
      expect(getAuthErrorKey('Too many login attempts')).toBe('tooManyAttempts')
      expect(getAuthErrorKey('Too many requests')).toBe('tooManyAttempts')
    })
  })

  describe('network errors', () => {
    it('handles network error', () => {
      expect(getAuthErrorKey('Network error occurred')).toBe('network')
      expect(getAuthErrorKey('Fetch failed')).toBe('network')
    })

    it('handles timeout error', () => {
      expect(getAuthErrorKey('Request timeout')).toBe('timeout')
      expect(getAuthErrorKey('Connection timed out')).toBe('timeout')
    })
  })

  describe('server errors', () => {
    it('handles internal server error', () => {
      expect(getAuthErrorKey('Internal server error')).toBe('internalServer')
      expect(getAuthErrorKey('Error 500')).toBe('internalServer')
    })

    it('handles service unavailable error', () => {
      expect(getAuthErrorKey('Service unavailable')).toBe('serviceUnavailable')
      expect(getAuthErrorKey('Error 503')).toBe('serviceUnavailable')
    })
  })

  describe('terms-consent errors', () => {
    it('maps the terms-not-accepted message to the termsNotAccepted key', () => {
      // Matches the exact APIError message thrown by assertTermsAccepted.
      expect(
        getAuthErrorKey(
          'You must accept the Terms of Service and Privacy Policy to create an account.',
        ),
      ).toBe('termsNotAccepted')
    })
  })

  describe('invite-code errors', () => {
    it('maps the missing-code message to the inviteCodeRequired key', () => {
      // Matches the exact APIError message thrown by validateAndClaimInviteCode.
      expect(getAuthErrorKey('An invite code is required.')).toBe('inviteCodeRequired')
    })

    it('maps the invalid/expired/used-code message to the inviteCodeInvalid key', () => {
      expect(getAuthErrorKey('This invite code is invalid, expired, or already used.')).toBe(
        'inviteCodeInvalid',
      )
    })

    it('takes precedence over the generic Forbidden mapping', () => {
      // Better Auth wraps the throw in a FORBIDDEN response; without the
      // ordering in auth-errors.ts the keyword "forbidden" upstream of the
      // user message could swallow these into the CSRF copy.
      expect(getAuthErrorKey('forbidden: An invite code is required.')).toBe('inviteCodeRequired')
    })
  })

  describe('security errors', () => {
    it('handles CSRF error', () => {
      expect(getAuthErrorKey('CSRF token invalid')).toBe('csrf')
      expect(getAuthErrorKey('Forbidden request')).toBe('csrf')
    })
  })

  describe('password reset errors', () => {
    it('handles expired token error', () => {
      expect(getAuthErrorKey('Token expired')).toBe('tokenExpired')
      expect(getAuthErrorKey('Reset token has expired')).toBe('tokenExpired')
      expect(getAuthErrorKey('Password reset token expired')).toBe('tokenExpired')
    })

    it('handles invalid token error', () => {
      expect(getAuthErrorKey('Invalid token')).toBe('tokenInvalid')
      expect(getAuthErrorKey('Token is invalid or has been used')).toBe('tokenInvalid')
      expect(getAuthErrorKey('Password reset token invalid')).toBe('tokenInvalid')
    })

    it('handles user not found during password reset', () => {
      expect(getAuthErrorKey('User not found for password reset')).toBe('resetUserNotFound')
      expect(getAuthErrorKey('Email not found during reset attempt')).toBe('resetUserNotFound')
      expect(getAuthErrorKey('No user found for reset')).toBe('resetUserNotFound')
    })

    it('does not match generic user not found without reset context', () => {
      expect(getAuthErrorKey('User not found')).toBe('userNotFound')
      expect(getAuthErrorKey('No user exists')).toBe('userNotFound')
    })
  })

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      expect(getAuthErrorKey('')).toBeNull()
    })

    it('returns null for unmapped error message', () => {
      expect(getAuthErrorKey('Some custom error message')).toBeNull()
    })

    it('handles case-insensitive matching', () => {
      expect(getAuthErrorKey('INVALID CREDENTIALS')).toBe('invalidCredentials')
      expect(getAuthErrorKey('Network ERROR')).toBe('network')
    })

    it('handles partial keyword matches', () => {
      expect(getAuthErrorKey('The provided credentials are invalid for this user')).toBe(
        'invalidCredentials',
      )
      expect(getAuthErrorKey('A network connection error has occurred')).toBe('network')
    })
  })

  describe('real-world error scenarios', () => {
    it('handles offline scenario', () => {
      expect(getAuthErrorKey('Fetch failed')).toBe('network')
    })

    it('handles slow connection', () => {
      expect(getAuthErrorKey('Request timed out after 30s')).toBe('timeout')
    })

    it('handles duplicate registration', () => {
      expect(getAuthErrorKey('User with this email already exists in database')).toBe(
        'accountAlreadyExists',
      )
    })

    it('handles login with wrong password', () => {
      expect(getAuthErrorKey('The password provided is incorrect')).toBe('incorrectPassword')
    })
  })
})

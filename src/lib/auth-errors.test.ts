import { describe, it, expect } from 'vitest'
import { getUserFriendlyError } from './auth-errors'

describe('getUserFriendlyError', () => {
  describe('authentication errors', () => {
    it('handles invalid credentials error', () => {
      expect(getUserFriendlyError('Invalid credentials')).toBe(
        'The email or password you entered is incorrect. Please try again.',
      )
      expect(getUserFriendlyError('invalid credentials provided')).toBe(
        'The email or password you entered is incorrect. Please try again.',
      )
    })

    it('handles user not found error', () => {
      expect(getUserFriendlyError('User not found')).toBe(
        'No account found with this email address.',
      )
      expect(getUserFriendlyError('No user exists')).toBe(
        'No account found with this email address.',
      )
    })

    it('handles incorrect password error', () => {
      expect(getUserFriendlyError('Password incorrect')).toBe(
        'The password you entered is incorrect. Please try again.',
      )
      expect(getUserFriendlyError('Incorrect password provided')).toBe(
        'The password you entered is incorrect. Please try again.',
      )
    })
  })

  describe('account existence errors', () => {
    it('handles account already exists error', () => {
      expect(getUserFriendlyError('User already exists')).toBe(
        'An account with this email address already exists. Try signing in instead.',
      )
      expect(getUserFriendlyError('Email already registered')).toBe(
        'An account with this email address already exists. Try signing in instead.',
      )
    })
  })

  describe('validation errors', () => {
    it('handles invalid email error', () => {
      expect(getUserFriendlyError('Invalid email format')).toBe(
        'Please enter a valid email address.',
      )
      expect(getUserFriendlyError('Invalid email address')).toBe(
        'Please enter a valid email address.',
      )
    })

    it('handles password too short error', () => {
      expect(getUserFriendlyError('Password too short')).toBe(
        'Password must be at least 8 characters long.',
      )
      expect(getUserFriendlyError('Password minimum length not met')).toBe(
        'Password must be at least 8 characters long.',
      )
    })

    it('handles weak password error', () => {
      expect(getUserFriendlyError('Password is too weak')).toBe(
        'Please choose a stronger password.',
      )
      expect(getUserFriendlyError('Weak password provided')).toBe(
        'Please choose a stronger password.',
      )
    })
  })

  describe('rate limiting errors', () => {
    it('handles too many attempts error', () => {
      expect(getUserFriendlyError('Too many login attempts')).toBe(
        'Too many attempts. Please try again in a few minutes.',
      )
      expect(getUserFriendlyError('Too many requests')).toBe(
        'Too many attempts. Please try again in a few minutes.',
      )
    })
  })

  describe('network errors', () => {
    it('handles network error', () => {
      expect(getUserFriendlyError('Network error occurred')).toBe(
        'Unable to connect to the server. Please check your internet connection and try again.',
      )
      expect(getUserFriendlyError('Fetch failed')).toBe(
        'Unable to connect to the server. Please check your internet connection and try again.',
      )
    })

    it('handles timeout error', () => {
      expect(getUserFriendlyError('Request timeout')).toBe(
        'Request timed out. Please check your connection and try again.',
      )
      expect(getUserFriendlyError('Connection timed out')).toBe(
        'Request timed out. Please check your connection and try again.',
      )
    })
  })

  describe('server errors', () => {
    it('handles internal server error', () => {
      expect(getUserFriendlyError('Internal server error')).toBe(
        'Server is experiencing issues. Please try again in a moment.',
      )
      expect(getUserFriendlyError('Error 500')).toBe(
        'Server is experiencing issues. Please try again in a moment.',
      )
    })

    it('handles service unavailable error', () => {
      expect(getUserFriendlyError('Service unavailable')).toBe(
        'Service is temporarily unavailable. Please try again later.',
      )
      expect(getUserFriendlyError('Error 503')).toBe(
        'Service is temporarily unavailable. Please try again later.',
      )
    })
  })

  describe('security errors', () => {
    it('handles CSRF error', () => {
      expect(getUserFriendlyError('CSRF token invalid')).toBe(
        'Security validation failed. Please refresh the page and try again.',
      )
      expect(getUserFriendlyError('Forbidden request')).toBe(
        'Security validation failed. Please refresh the page and try again.',
      )
    })
  })

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(getUserFriendlyError('')).toBe('An unexpected error occurred. Please try again.')
    })

    it('handles unmapped error message', () => {
      const customError = 'Some custom error message'
      expect(getUserFriendlyError(customError)).toBe(customError)
    })

    it('handles case-insensitive matching', () => {
      expect(getUserFriendlyError('INVALID CREDENTIALS')).toBe(
        'The email or password you entered is incorrect. Please try again.',
      )
      expect(getUserFriendlyError('Network ERROR')).toBe(
        'Unable to connect to the server. Please check your internet connection and try again.',
      )
    })

    it('handles partial keyword matches', () => {
      expect(getUserFriendlyError('The provided credentials are invalid for this user')).toBe(
        'The email or password you entered is incorrect. Please try again.',
      )
      expect(getUserFriendlyError('A network connection error has occurred')).toBe(
        'Unable to connect to the server. Please check your internet connection and try again.',
      )
    })
  })

  describe('real-world error scenarios', () => {
    it('handles offline scenario', () => {
      expect(getUserFriendlyError('Fetch failed')).toBe(
        'Unable to connect to the server. Please check your internet connection and try again.',
      )
    })

    it('handles slow connection', () => {
      expect(getUserFriendlyError('Request timed out after 30s')).toBe(
        'Request timed out. Please check your connection and try again.',
      )
    })

    it('handles duplicate registration', () => {
      expect(getUserFriendlyError('User with this email already exists in database')).toBe(
        'An account with this email address already exists. Try signing in instead.',
      )
    })

    it('handles login with wrong password', () => {
      expect(getUserFriendlyError('The password provided is incorrect')).toBe(
        'The password you entered is incorrect. Please try again.',
      )
    })
  })
})

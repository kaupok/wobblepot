/**
 * Maps API error messages to user-friendly messages
 * Used across authentication flows (sign-in, sign-up)
 */
export function getUserFriendlyError(message: string): string {
  if (!message) {
    return 'An unexpected error occurred. Please try again.'
  }

  const lowerMessage = message.toLowerCase()

  // Authentication errors
  if (lowerMessage.includes('invalid') && lowerMessage.includes('credentials')) {
    return 'The email or password you entered is incorrect. Please try again.'
  }
  if (lowerMessage.includes('user not found') || lowerMessage.includes('no user')) {
    return 'No account found with this email address.'
  }
  if (lowerMessage.includes('password') && lowerMessage.includes('incorrect')) {
    return 'The password you entered is incorrect. Please try again.'
  }

  // Account existence errors
  if (lowerMessage.includes('already exists') || lowerMessage.includes('already registered')) {
    return 'An account with this email address already exists. Try signing in instead.'
  }

  // Security errors (must come before password reset token checks to avoid false matches)
  if (lowerMessage.includes('csrf') || lowerMessage.includes('forbidden')) {
    return 'Security validation failed. Please refresh the page and try again.'
  }

  // Password reset errors
  if (lowerMessage.includes('token') && lowerMessage.includes('expired')) {
    return 'This password reset link has expired. Please request a new one.'
  }
  if (lowerMessage.includes('token') && lowerMessage.includes('invalid')) {
    return 'This password reset link is invalid. Please request a new one.'
  }
  if (
    (lowerMessage.includes('email not found') || lowerMessage.includes('user not found')) &&
    lowerMessage.includes('reset')
  ) {
    return 'If an account exists with this email, you will receive a reset link.'
  }

  // Validation errors
  if (lowerMessage.includes('invalid email')) {
    return 'Please enter a valid email address.'
  }
  if (
    lowerMessage.includes('password') &&
    (lowerMessage.includes('short') || lowerMessage.includes('minimum'))
  ) {
    return 'Password must be at least 8 characters long.'
  }
  if (lowerMessage.includes('password') && lowerMessage.includes('weak')) {
    return 'Please choose a stronger password.'
  }

  // Rate limiting
  if (lowerMessage.includes('too many')) {
    return 'Too many attempts. Please try again in a few minutes.'
  }

  // Network errors
  if (lowerMessage.includes('network') || lowerMessage.includes('fetch failed')) {
    return 'Unable to connect to the server. Please check your internet connection and try again.'
  }
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return 'Request timed out. Please check your connection and try again.'
  }

  // Server errors
  if (lowerMessage.includes('internal server') || lowerMessage.includes('500')) {
    return 'Server is experiencing issues. Please try again in a moment.'
  }
  if (lowerMessage.includes('service unavailable') || lowerMessage.includes('503')) {
    return 'Service is temporarily unavailable. Please try again later.'
  }

  // Return the original message if no mapping found
  return message
}

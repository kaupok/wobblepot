import { betterAuth } from 'better-auth'
import { DatabaseSync } from 'node:sqlite'

/**
 * Better Auth configuration
 *
 * This is the main server-side authentication instance. It handles:
 * - Email/password authentication
 * - Session management
 * - CSRF protection via trustedOrigins
 *
 * @see https://www.better-auth.com/docs
 */
export const auth = betterAuth({
  /**
   * Database configuration
   * Using SQLite for development. Replace with a proper database for production.
   */
  database: new DatabaseSync('database.sqlite'),

  /**
   * Base URL for the application
   * Used for generating absolute URLs and CSRF protection
   */
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',

  /**
   * Trusted origins for CSRF protection
   * Requests from origins not in this list will be blocked
   */
  trustedOrigins: [process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'],

  /**
   * Email and password authentication configuration
   */
  emailAndPassword: {
    enabled: true,
    /**
     * Automatically sign in users after successful registration
     */
    autoSignIn: true,
    /**
     * Password requirements (defaults shown)
     * minPasswordLength: 8
     * maxPasswordLength: 128
     */
  },
})

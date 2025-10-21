import { betterAuth } from 'better-auth'
import { DatabaseSync } from 'node:sqlite'
import { serverEnv } from '@/lib/env'

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
   * Secret key for encryption and signing
   * Automatically loaded from BETTER_AUTH_SECRET environment variable
   */
  secret: serverEnv.BETTER_AUTH_SECRET,

  /**
   * Base URL for the application
   * Used for generating absolute URLs and CSRF protection
   */
  baseURL: serverEnv.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',

  /**
   * Trusted origins for CSRF protection
   * Requests from origins not in this list will be blocked
   */
  trustedOrigins: [serverEnv.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'],

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

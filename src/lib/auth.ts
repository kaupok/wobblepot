import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from '@/lib/prisma'
import { serverEnv, getServerBaseURL } from '@/lib/env'

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
   * Using Prisma adapter with Neon PostgreSQL
   */
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  /**
   * Secret key for encryption and signing
   * Automatically loaded from BETTER_AUTH_SECRET environment variable
   */
  secret: serverEnv.BETTER_AUTH_SECRET,

  /**
   * Base URL for the application
   * Used for generating absolute URLs and CSRF protection
   */
  baseURL: getServerBaseURL(),

  /**
   * Trusted origins for CSRF protection
   * Requests from origins not in this list will be blocked
   */
  trustedOrigins: [getServerBaseURL()],

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

/**
 * Infer the session type from Better Auth
 */
export type Session = typeof auth.$Infer.Session

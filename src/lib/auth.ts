import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from '@/lib/prisma'
import { serverEnv, getServerBaseURL } from '@/lib/env'

/**
 * Better Auth configuration (lazy-initialized)
 *
 * This is the main server-side authentication instance. It handles:
 * - Email/password authentication
 * - Session management
 * - CSRF protection via trustedOrigins
 *
 * Uses lazy initialization to avoid accessing environment variables during build time.
 *
 * @see https://www.better-auth.com/docs
 */
let authInstance: ReturnType<typeof betterAuth> | null = null

function getAuthInstance() {
  if (!authInstance) {
    authInstance = betterAuth({
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
        /**
         * Password reset configuration
         * Sends reset email with token to user
         */
        sendResetPassword: async ({ user, url }) => {
          // For development: log the reset URL to console
          // In production: replace with actual email service (e.g., Resend, SendGrid)
          // eslint-disable-next-line no-console
          console.log('='.repeat(60))
          // eslint-disable-next-line no-console
          console.log('PASSWORD RESET REQUESTED')
          // eslint-disable-next-line no-console
          console.log('='.repeat(60))
          // eslint-disable-next-line no-console
          console.log(`User: ${user.email}`)
          // eslint-disable-next-line no-console
          console.log(`Name: ${user.name}`)
          // eslint-disable-next-line no-console
          console.log(`Reset URL: ${url}`)
          // eslint-disable-next-line no-console
          console.log('='.repeat(60))
          // eslint-disable-next-line no-console
          console.log('\nIn production, replace this with an email service.')
          // eslint-disable-next-line no-console
          console.log('For now, copy the URL above to reset the password.\n')

          // TODO: Implement actual email sending when email service is configured
          // Example with Resend:
          // await resend.emails.send({
          //   from: 'noreply@yourdomain.com',
          //   to: user.email,
          //   subject: 'Reset your password',
          //   html: `Click <a href="${url}">here</a> to reset your password.`
          // });
        },
      },
    })
  }
  return authInstance
}

/**
 * Export auth instance with lazy initialization via Proxy
 * This ensures environment variables are only accessed at runtime, not build time
 */
export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
  get(_target, prop) {
    return getAuthInstance()[prop as keyof ReturnType<typeof betterAuth>]
  },
})

/**
 * Infer the session type from Better Auth
 */
export type Session = typeof auth.$Infer.Session

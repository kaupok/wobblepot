import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { hashPassword } from 'better-auth/crypto'
import { prismaAdapter } from '@better-auth/prisma-adapter'
import { prisma, type PrismaClientType } from '@/lib/prisma'
import { serverEnv, getServerBaseURL } from '@/lib/env'
import { resend, isEmailConfigured } from '@/lib/resend'
import { generateResetPasswordEmail } from '@/lib/emails/reset-password'
import { isPasswordBreached } from '@/lib/breached-password'

const MIN_PASSWORD_LENGTH = 12

const BREACHED_PASSWORD_MESSAGE =
  'That password appears in known data breaches. Please pick a different one.'

/**
 * Creates a household for a new user with default preferences
 * Called after user signup to set up their initial household
 */
export async function createHouseholdForUser(
  userId: string,
  userName: string,
  db: PrismaClientType = prisma,
) {
  await db.$transaction(async (tx) => {
    const household = await tx.household.create({
      data: {
        name: `${userName}'s Household`,
      },
    })

    await tx.householdMember.create({
      data: {
        householdId: household.id,
        userId: userId,
        role: 'owner',
      },
    })

    await tx.householdPreferences.create({
      data: {
        householdId: household.id,
        // Uses schema defaults: weekdayMealTypes: [dinner], weekendMealTypes: [dinner]
      },
    })
  })
}

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
   * Custom password hashing that runs an HIBP breach check before
   * delegating to Better Auth's default scrypt. `hash` is only invoked
   * when storing a new password (sign-up, reset, change), so existing
   * users with shorter or known-breached passwords keep working.
   */
  password: {
    hash: async (password: string) => {
      if (await isPasswordBreached(password)) {
        throw new APIError('BAD_REQUEST', {
          message: BREACHED_PASSWORD_MESSAGE,
          code: 'PASSWORD_COMPROMISED',
        })
      }
      return hashPassword(password)
    },
  },

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
     * Stricter than the Better Auth default of 8 — see HON-464.
     * Existing users with shorter passwords are unaffected: the
     * minimum is enforced at sign-up and password reset only.
     */
    minPasswordLength: MIN_PASSWORD_LENGTH,
    /**
     * Password reset email handler
     * Sends email via Resend. Errors are logged but not thrown
     * to prevent account enumeration attacks.
     */
    sendResetPassword: async ({ user, url }) => {
      // Check if email is configured (for CI/build environments)
      const fromEmail = serverEnv.RESEND_FROM_EMAIL
      if (!isEmailConfigured() || !resend || !fromEmail) {
        // eslint-disable-next-line no-console
        console.warn('Email not configured. Password reset email not sent.')
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.log('Reset URL:', url)
        }
        return
      }

      const emailContent = generateResetPasswordEmail({ resetUrl: url })

      try {
        await resend.emails.send({
          from: fromEmail,
          to: user.email,
          ...emailContent,
        })
      } catch (error) {
        // Log error but don't throw - prevents account enumeration
        // eslint-disable-next-line no-console
        console.error('Failed to send password reset email:', error)
      }
    },
  },
})

/**
 * Infer the session type from Better Auth
 */
export type Session = typeof auth.$Infer.Session

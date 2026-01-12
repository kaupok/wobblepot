import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma, type PrismaClientType } from '@/lib/prisma'
import { serverEnv, getServerBaseURL } from '@/lib/env'
import { resend, isEmailConfigured } from '@/lib/resend'
import { generateResetPasswordEmail } from '@/lib/emails/reset-password'

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
        // eslint-disable-next-line no-console
        console.log('Reset URL:', url)
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

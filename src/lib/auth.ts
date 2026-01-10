import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma, type PrismaClientType } from '@/lib/prisma'
import { serverEnv, getServerBaseURL } from '@/lib/env'

/**
 * Creates a household for a new user with default preferences
 * Called after user signup to set up their initial household
 */
export async function createHouseholdForUser(
  userId: string,
  userName: string,
  db: PrismaClientType = prisma
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
   * Database hooks for lifecycle events
   * Used to perform additional actions after core operations
   */
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await createHouseholdForUser(user.id, user.name)
        },
      },
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
     * Password requirements (defaults shown)
     * minPasswordLength: 8
     * maxPasswordLength: 128
     */
    /**
     * Password reset email handler
     * Currently mocked with console.log for development
     * TODO: Replace with real email provider (see separate Linear issue)
     */
    sendResetPassword: async ({ user, url, token }) => {
      console.log('=== PASSWORD RESET EMAIL (MOCK) ===')
      console.log('To:', user.email)
      console.log('Reset URL:', url)
      console.log('Token:', token)
      console.log('=====================================')

      // TODO: Replace with real email sending when provider is configured
      // Example with Resend:
      // await resend.emails.send({
      //   from: 'noreply@honkadori.com',
      //   to: user.email,
      //   subject: 'Reset your password',
      //   html: `Click here to reset your password: ${url}`
      // })
    },
  },
})

/**
 * Infer the session type from Better Auth
 */
export type Session = typeof auth.$Infer.Session

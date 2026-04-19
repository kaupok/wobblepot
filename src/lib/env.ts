import { z } from 'zod'

/**
 * Client environment variable validation schema
 *
 * Contains only NEXT_PUBLIC_* variables that are safe to use in client-side code.
 * These variables are embedded in the client bundle and visible in the browser.
 *
 * @see {@link clientEnv} for the validated client environment object
 */
export const clientEnvSchema = z.object({
  // Public variables (accessible in browser, prefixed with NEXT_PUBLIC_)
  NEXT_PUBLIC_APP_NAME: z
    .string()
    .min(1, 'Application name must not be empty')
    .describe('Application display name (required)'),

  NEXT_PUBLIC_APP_URL: z
    .string()
    .url()
    .optional()
    .describe('Public application URL (e.g., https://app.example.com)'),

  NEXT_PUBLIC_APP_ENV: z
    .enum(['dev', 'preview', 'staging', 'production', 'ci', 'test'])
    .describe('Application environment (dev, preview, staging, production, ci, or test)'),
})

/**
 * Server-only environment variable validation schema
 *
 * Contains only server-side variables (not prefixed with NEXT_PUBLIC_).
 * These are validated lazily when accessed, not at module load time.
 */
const serverOnlyEnvSchema = z.object({
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters for security')
    .describe('Secret key for Better Auth (generate with: openssl rand -base64 32)'),

  DATABASE_URL: z
    .string()
    .url()
    .describe('Database connection string for Prisma (pooled connection for Neon)'),

  DATABASE_URL_UNPOOLED: z
    .string()
    .url()
    .describe('Direct database connection string for migrations (non-pooled for Neon)'),

  ANTHROPIC_API_KEY: z
    .string()
    .min(1, 'ANTHROPIC_API_KEY is required for AI features')
    .describe('Anthropic API key for Claude AI integration'),

  RESEND_API_KEY: z
    .string()
    .min(1, 'RESEND_API_KEY is required for email sending')
    .optional()
    .describe('Resend API key for sending emails (get from https://resend.com/api-keys)'),

  RESEND_FROM_EMAIL: z
    .string()
    .email('RESEND_FROM_EMAIL must be a valid email address')
    .optional()
    .describe('Email address to send from (must be verified in Resend)'),

  UPSTASH_REDIS_REST_URL: z
    .string()
    .url('UPSTASH_REDIS_REST_URL must be a valid URL')
    .describe(
      'Upstash Redis REST URL (auto-injected by the Vercel Marketplace Upstash integration on deploy)',
    ),

  UPSTASH_REDIS_REST_TOKEN: z
    .string()
    .min(1, 'UPSTASH_REDIS_REST_TOKEN is required for rate limiting')
    .describe('Upstash Redis REST token (auto-injected by the Vercel Marketplace integration)'),
})

/**
 * Complete server environment variable validation schema
 *
 * Combines client and server-only variables for type inference.
 *
 * @see {@link serverEnv} for the validated server environment object
 */
export const serverEnvSchema = clientEnvSchema.merge(serverOnlyEnvSchema)

/**
 * Validated client-side environment variables
 *
 * Safe to use in client components and browser code. Only contains NEXT_PUBLIC_* variables.
 * Throws an error during module load if validation fails.
 *
 * @example
 * ```typescript
 * import { clientEnv } from '@/lib/env'
 *
 * console.log(clientEnv.NEXT_PUBLIC_APP_NAME)  // 'My App'
 * ```
 *
 * @throws {Error} If client environment validation fails
 */
export const clientEnv = (() => {
  // Explicitly reference env vars so they survive Next.js client bundling
  const envVars = {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  }

  const parsed = clientEnvSchema.safeParse(envVars)

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors
    const errorMessages = Object.entries(fieldErrors)
      .map(([field, errors]) => {
        const messages = (errors ?? []).join(', ')
        return `  • ${field}: ${messages}`
      })
      .join('\n')

    // eslint-disable-next-line no-console
    console.error('❌ Invalid client environment variables:\n' + errorMessages)

    throw new Error(
      `Invalid environment variables. Check your .env and .env.local files.\n${errorMessages}`,
    )
  }

  return parsed.data
})()

/**
 * Validated server-side environment variables
 *
 * Includes both NEXT_PUBLIC_* and server-only variables. Only use in server components,
 * API routes, and server-side code.
 *
 * Uses lazy validation: server-only variables are validated when accessed, not at module
 * load time. This allows the module to be bundled for the client without errors, while
 * still enforcing that required variables exist when actually used on the server.
 *
 * @example
 * ```typescript
 * import { serverEnv } from '@/lib/env'
 *
 * console.log(serverEnv.BETTER_AUTH_SECRET)  // Validated on access
 * console.log(serverEnv.NEXT_PUBLIC_APP_NAME)  // Also available
 * ```
 *
 * @throws {Error} If a server-only variable is undefined when accessed
 */
export const serverEnv = new Proxy(
  {
    // Client vars are already validated
    ...clientEnv,
    // Server-only vars from process.env (validated on access)
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  } as z.infer<typeof serverEnvSchema>,
  {
    get(target, prop) {
      const value = target[prop as keyof typeof target]

      // For server-only variables (not NEXT_PUBLIC_*), validate when accessed
      if (typeof prop === 'string' && !prop.startsWith('NEXT_PUBLIC_')) {
        // Parse just this field to get validation errors
        const fieldSchema =
          serverOnlyEnvSchema.shape[prop as keyof typeof serverOnlyEnvSchema.shape]

        if (fieldSchema) {
          const result = fieldSchema.safeParse(value)

          if (!result.success) {
            const errorMessage = result.error.issues.map((e) => e.message).join(', ')
            // eslint-disable-next-line no-console
            console.error(`❌ Invalid server environment variable ${String(prop)}: ${errorMessage}`)

            throw new Error(
              `Invalid environment variable ${String(prop)}: ${errorMessage}\n` +
                `Check your .env and .env.local files and restart the dev server.`,
            )
          }

          return result.data
        }
      }

      return value
    },
  },
)

/**
 * Type for client environment variables
 */
export type ClientEnv = typeof clientEnv

/**
 * Type for server environment variables
 */
export type ServerEnv = z.infer<typeof serverEnvSchema>

/**
 * Gets the base URL for client-side code (browser)
 *
 * Priority:
 * 1. NEXT_PUBLIC_APP_URL (explicitly set in env)
 * 2. NEXT_PUBLIC_VERCEL_URL (automatically set by Vercel for all deployments)
 * 3. http://localhost:3000 (local development fallback)
 *
 * @returns The base URL as a string
 */
export function getClientBaseURL(): string {
  if (clientEnv.NEXT_PUBLIC_APP_URL) {
    return clientEnv.NEXT_PUBLIC_APP_URL
  }

  // Vercel sets NEXT_PUBLIC_VERCEL_URL automatically for all deployments
  if (process.env.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
  }

  return 'http://localhost:3000'
}

/**
 * Gets the base URL for server-side code (Node.js)
 *
 * Priority:
 * 1. NEXT_PUBLIC_APP_URL (explicitly set in env)
 * 2. VERCEL_URL (automatically set by Vercel for all deployments)
 * 3. http://localhost:3000 (local development fallback)
 *
 * @returns The base URL as a string
 */
export function getServerBaseURL(): string {
  if (serverEnv.NEXT_PUBLIC_APP_URL) {
    return serverEnv.NEXT_PUBLIC_APP_URL
  }

  // Vercel sets VERCEL_URL automatically for all deployments
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }

  return 'http://localhost:3000'
}

import { z } from 'zod'

/**
 * Environment variable validation schema
 *
 * Ensures all required and optional environment variables are properly typed and validated
 * at runtime, catching configuration errors early in the application lifecycle.
 *
 * @see {@link env} for the validated environment object
 * @see {@link Env} for the TypeScript type
 * @see {@link envSchema} for the Zod schema (useful for testing validation behavior)
 *
 * @example
 * ```typescript
 * import { env } from '@/lib/env'
 *
 * console.log(env.NEXT_PUBLIC_APP_NAME)  // 'My App'
 * ```
 */
export const envSchema = z.object({
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

  // Server-only variables (only available on server-side)
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters for security')
    .describe('Secret key for Better Auth (generate with: openssl rand -base64 32)'),
})

/**
 * Parsed and validated environment variables
 *
 * Throws an error during module load if validation fails. This ensures the application
 * fails fast with clear error messages if required environment variables are missing
 * or invalid.
 *
 * Note: We explicitly destructure process.env vars before validating to ensure they
 * survive Next.js client bundling. The Next.js compiler removes process.env references
 * that aren't explicitly accessed, so we must reference each variable directly to
 * preserve their values in client bundles.
 *
 * @throws {Error} If environment validation fails
 */
export const env = (() => {
  // Explicitly reference env vars so they survive Next.js client bundling
  const envVars = {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  }

  const parsed = envSchema.safeParse(envVars)

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors
    const errorMessages = Object.entries(fieldErrors)
      .map(([field, errors]) => {
        const messages = (errors ?? []).join(', ')
        return `  • ${field}: ${messages}`
      })
      .join('\n')

    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment variables:\n' + errorMessages)

    throw new Error(
      `Invalid environment variables. Check your .env and .env.local files.\n${errorMessages}`,
    )
  }

  return parsed.data
})()

/**
 * Type-safe environment variable object
 *
 * Use this type to ensure proper typing when destructuring or spreading env vars.
 *
 * @example
 * ```typescript
 * const { NEXT_PUBLIC_APP_NAME }: Env = env
 * ```
 */
export type Env = typeof env

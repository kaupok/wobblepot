import { z } from 'zod'

/**
 * Environment variable validation schema
 *
 * Ensures all required and optional environment variables are properly typed and validated
 * at runtime, catching configuration errors early in the application lifecycle.
 *
 * @see {@link env} for the validated environment object
 * @see {@link Env} for the TypeScript type
 *
 * @example
 * ```typescript
 * import { env } from '@/lib/env'
 *
 * console.log(env.NEXT_PUBLIC_APP_NAME)  // 'Honkadori'
 * ```
 */
const envSchema = z.object({
  // Public variables (accessible in browser, prefixed with NEXT_PUBLIC_)
  NEXT_PUBLIC_APP_NAME: z.string().default('Honkadori').describe('Application display name'),

  NEXT_PUBLIC_APP_URL: z
    .string()
    .url()
    .optional()
    .describe('Public application URL (e.g., https://app.example.com)'),

  // Server-only variables (only available on server-side)
  // Add your server-only env vars here as needed
})

/**
 * Parsed and validated environment variables
 *
 * Throws an error during module load if validation fails. This ensures the application
 * fails fast with clear error messages if required environment variables are missing
 * or invalid.
 *
 * @throws {Error} If environment validation fails
 */
export const env = (() => {
  const parsed = envSchema.safeParse(process.env)

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

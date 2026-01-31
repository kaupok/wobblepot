import { NextResponse } from 'next/server'

/**
 * Temporary debug endpoint to check which database a deployment is connected to.
 * DELETE THIS after verifying preview vs staging DB config.
 */
export async function GET() {
  const dbUrl = process.env.DATABASE_URL ?? ''
  // Extract just the host portion — no credentials
  const match = dbUrl.match(/@([^/]+)\//)
  const host = match?.[1] ?? 'unknown'

  return NextResponse.json({
    env: process.env.NEXT_PUBLIC_APP_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    dbHost: host,
  })
}

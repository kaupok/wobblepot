import { NextResponse } from 'next/server'

import { pingDatabase } from '@/lib/status/probes'

export const dynamic = 'force-dynamic'

export async function GET() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? 'local'
  const timestamp = new Date().toISOString()

  try {
    await pingDatabase()
    return NextResponse.json({ status: 'ok', db: 'ok', commit, timestamp })
  } catch {
    return NextResponse.json(
      { status: 'error', db: 'unreachable', commit, timestamp },
      { status: 503 },
    )
  }
}

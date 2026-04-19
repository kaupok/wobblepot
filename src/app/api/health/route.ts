import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const DB_TIMEOUT_MS = 2000

export async function GET() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? 'local'
  const timestamp = new Date().toISOString()

  try {
    await Promise.race([
      prisma.$queryRawUnsafe('SELECT 1'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DB probe timeout')), DB_TIMEOUT_MS),
      ),
    ])

    return NextResponse.json({ status: 'ok', db: 'ok', commit, timestamp })
  } catch {
    return NextResponse.json(
      { status: 'error', db: 'unreachable', commit, timestamp },
      { status: 503 },
    )
  }
}

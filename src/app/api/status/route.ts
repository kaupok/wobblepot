import { NextResponse } from 'next/server'
import { getStatusSnapshot, computeOverall } from '@/lib/status/probes'

export const dynamic = 'force-dynamic'

/**
 * Returns the current status snapshot as JSON.
 *
 * Always responds 200 — this is a data endpoint for the `/status` page, not a
 * monitor check. `/api/health` keeps the 200/503 semantics that uptime monitors
 * (HON-484) depend on.
 */
export async function GET() {
  const snapshot = await getStatusSnapshot()
  const overall = computeOverall(snapshot)

  return NextResponse.json({
    overall,
    components: {
      db: snapshot.db,
      auth: snapshot.auth,
      ai: snapshot.ai,
    },
    incidentMessage: snapshot.incidentMessage,
    timestamp: snapshot.timestamp,
  })
}

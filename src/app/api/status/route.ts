import { NextResponse } from 'next/server'
import { getStatusSnapshot, computeOverall, type ProbeResult } from '@/lib/status/probes'

export const dynamic = 'force-dynamic'

/**
 * Returns the current status snapshot as JSON.
 *
 * Always responds 200 — this is a data endpoint for the `/status` page, not a
 * monitor check. `/api/health` keeps the 200/503 semantics that uptime monitors
 * (HON-484) depend on.
 *
 * The raw `error` field is stripped from the public payload: this endpoint is
 * unauthenticated, and Prisma/Anthropic error messages can leak infrastructure
 * detail (Neon hostnames, schema hints, internal request IDs). The error is
 * retained on the internal `ProbeResult` for logging.
 */
export async function GET() {
  const snapshot = await getStatusSnapshot()
  const overall = computeOverall(snapshot)

  return NextResponse.json({
    overall,
    components: {
      db: toPublic(snapshot.db),
      auth: toPublic(snapshot.auth),
      ai: toPublic(snapshot.ai),
    },
    incidentMessage: snapshot.incidentMessage,
    timestamp: snapshot.timestamp,
    // Commit SHA of the deployed build. Used by staging-smoke.yml to
    // verify the new deploy is actually serving before smoke tests run
    // (vs. racing against a stale Vercel build). `undefined` in local dev
    // and omitted from the JSON payload in that case.
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
  })
}

function toPublic({ status, checkedAt, latencyMs }: ProbeResult) {
  return { status, checkedAt, latencyMs }
}

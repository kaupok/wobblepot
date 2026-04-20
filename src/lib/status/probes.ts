import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'

export type ProbeStatus = 'ok' | 'down'

export interface ProbeResult {
  status: ProbeStatus
  checkedAt: string
  latencyMs: number
  error?: string
}

export interface StatusSnapshot {
  db: ProbeResult
  auth: ProbeResult
  ai: ProbeResult
  timestamp: string
  incidentMessage?: string
}

export type OverallStatus = 'ok' | 'degraded' | 'down'

const DB_TIMEOUT_MS = 2000
const AUTH_TIMEOUT_MS = 2000
const AI_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 60_000

const STATUS_PROBE_MODEL = 'claude-haiku-4-5'

const ProbeResponseSchema = z.object({ ok: z.literal(true) })

interface CacheEntry {
  result: ProbeResult
  cachedAt: number
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<ProbeResult>>()

/**
 * Reset the in-memory probe cache. Test-only.
 */
export function __resetProbeCache(): void {
  cache.clear()
  inFlight.clear()
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Probe timeout after ${timeoutMs}ms`)), timeoutMs),
    ),
  ])
}

async function runCached(name: string, fn: () => Promise<ProbeResult>): Promise<ProbeResult> {
  const cached = cache.get(name)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.result
  }

  const existing = inFlight.get(name)
  if (existing) return existing

  const promise = (async () => {
    try {
      const result = await fn()
      cache.set(name, { result, cachedAt: Date.now() })
      return result
    } finally {
      inFlight.delete(name)
    }
  })()

  inFlight.set(name, promise)
  return promise
}

async function measure<T>(
  fn: () => Promise<T>,
): Promise<{ value?: T; error?: Error; latencyMs: number }> {
  const start = Date.now()
  try {
    const value = await fn()
    return { value, latencyMs: Date.now() - start }
  } catch (err) {
    return { error: err as Error, latencyMs: Date.now() - start }
  }
}

/**
 * Probe the database by running `SELECT 1` with a short timeout. Mirrors the
 * `/api/health` endpoint's DB check (see HON-454).
 */
export async function probeDatabase(): Promise<ProbeResult> {
  return runCached('db', async () => {
    const { error, latencyMs } = await measure(() =>
      withTimeout(prisma.$queryRaw`SELECT 1`, DB_TIMEOUT_MS),
    )
    const checkedAt = new Date().toISOString()
    if (error) return { status: 'down', checkedAt, latencyMs, error: error.message }
    return { status: 'ok', checkedAt, latencyMs }
  })
}

/**
 * Probe auth by counting rows on the Session table — exercises the Prisma
 * adapter Better Auth depends on. A distinct signal from the raw `SELECT 1`
 * DB probe: it can succeed while auth would fail if the schema drifted.
 */
export async function probeAuth(): Promise<ProbeResult> {
  return runCached('auth', async () => {
    const { error, latencyMs } = await measure(() =>
      withTimeout(prisma.session.count(), AUTH_TIMEOUT_MS),
    )
    const checkedAt = new Date().toISOString()
    if (error) return { status: 'down', checkedAt, latencyMs, error: error.message }
    return { status: 'ok', checkedAt, latencyMs }
  })
}

/**
 * Probe the AI pipeline end-to-end: SDK → Anthropic API → model returns a
 * structured response. Uses Haiku to keep probe cost negligible; result is
 * cached 60s so a hammered /status page can't turn into a cost vector.
 */
export async function probeAi(): Promise<ProbeResult> {
  return runCached('ai', async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
    const { error, latencyMs } = await measure(async () => {
      const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
      await generateObject({
        model: anthropic(STATUS_PROBE_MODEL),
        schema: ProbeResponseSchema,
        prompt: 'Respond with JSON matching { "ok": true } to confirm the pipeline is reachable.',
        abortSignal: controller.signal,
      })
    })
    clearTimeout(timer)
    const checkedAt = new Date().toISOString()
    if (error) return { status: 'down', checkedAt, latencyMs, error: error.message }
    return { status: 'ok', checkedAt, latencyMs }
  })
}

/**
 * Run all three probes in parallel and return a snapshot plus any operator-set
 * incident message. Probes are individually cached and timeout-bounded, so one
 * slow component does not stall the others.
 */
export async function getStatusSnapshot(): Promise<StatusSnapshot> {
  const [db, auth, ai] = await Promise.all([probeDatabase(), probeAuth(), probeAi()])
  return {
    db,
    auth,
    ai,
    timestamp: new Date().toISOString(),
    incidentMessage: serverEnv.STATUS_INCIDENT_MESSAGE || undefined,
  }
}

export function computeOverall(
  snapshot: Pick<StatusSnapshot, 'db' | 'auth' | 'ai'>,
): OverallStatus {
  const statuses = [snapshot.db.status, snapshot.auth.status, snapshot.ai.status]
  if (statuses.every((s) => s === 'ok')) return 'ok'
  if (statuses.every((s) => s === 'down')) return 'down'
  return 'degraded'
}

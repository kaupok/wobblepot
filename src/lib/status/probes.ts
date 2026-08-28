import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { getRedis } from '@/lib/upstash'

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
  rateLimit: ProbeResult
  timestamp: string
  incidentMessage?: string
}

export type OverallStatus = 'ok' | 'degraded' | 'down'

const DB_TIMEOUT_MS = 2000
const AUTH_TIMEOUT_MS = 2000
const RATE_LIMIT_TIMEOUT_MS = 2000
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
 * Probe the rate limiter's Upstash Redis backing with a `PING`.
 *
 * Auth deliberately no longer *fails* when Redis is down (`checkRateLimit`
 * fails open), which means nothing else on this page would show
 * it. Without this probe an Upstash outage is invisible: `/status` reported
 * `auth: ok` for ~2.5 months while every rate-limited POST — sign-in, sign-up,
 * password reset, and all AI endpoints — returned a bare 500.
 *
 * `down` here means abuse protection is off, not that the product is
 * unavailable, so it lands as `degraded` via `computeOverall`.
 */
export async function probeRateLimit(): Promise<ProbeResult> {
  return runCached('rateLimit', async () => {
    const { error, latencyMs } = await measure(() =>
      // `getRedis()` reads serverEnv and can throw synchronously on a
      // misconfigured deploy — call it inside `measure` so that counts as a
      // probe failure rather than escaping to the caller.
      withTimeout(
        Promise.resolve().then(() => getRedis().ping()),
        RATE_LIMIT_TIMEOUT_MS,
      ),
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
 * Run every probe in parallel and return a snapshot plus any operator-set
 * incident message. Probes are individually cached and timeout-bounded, so one
 * slow component does not stall the others.
 */
export async function getStatusSnapshot(): Promise<StatusSnapshot> {
  const [db, auth, ai, rateLimit] = await Promise.all([
    probeDatabase(),
    probeAuth(),
    probeAi(),
    probeRateLimit(),
  ])
  return {
    db,
    auth,
    ai,
    rateLimit,
    timestamp: new Date().toISOString(),
    incidentMessage: serverEnv.STATUS_INCIDENT_MESSAGE || undefined,
  }
}

export function computeOverall(
  snapshot: Pick<StatusSnapshot, 'db' | 'auth' | 'ai' | 'rateLimit'>,
): OverallStatus {
  const statuses = [
    snapshot.db.status,
    snapshot.auth.status,
    snapshot.ai.status,
    snapshot.rateLimit.status,
  ]
  if (statuses.every((s) => s === 'ok')) return 'ok'
  if (statuses.every((s) => s === 'down')) return 'down'
  return 'degraded'
}

// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildGoldenFiles,
  compareGolden,
  goldenBaselineCalls,
  goldenPath,
  promptHash,
  readGolden,
  writeGolden,
  type GoldenFile,
} from './golden'
import { runAgainstGolden, runCheck, type RunResult } from './runner'
import { errorScores, prepareCase } from './tasks'
import { loadStarterCases, mockModelFactory } from './test-utils'

const MODEL = 'claude-sonnet-5'
const tipsCases = loadStarterCases(['tips'])
const TIPS_REPLY = {
  object: { equipment: ['a', 'b', 'c'], steps: ['1', '2', '3', '4'], pitfalls: ['a', 'b'] },
}

async function recordedTips(runs = 2): Promise<{ result: RunResult; golden: GoldenFile }> {
  const { factory } = mockModelFactory(() => TIPS_REPLY)
  const result = await runCheck({
    cases: tipsCases,
    modelFor: () => MODEL,
    runs,
    maxUsd: 10,
    modelFactory: factory,
  })
  const [golden] = buildGoldenFiles({
    result,
    cases: tipsCases,
    tasks: ['tips'],
    modelFor: () => MODEL,
    runs,
    recordedAt: '2026-10-01',
    commit: 'abc1234',
  })
  return { result, golden: golden! }
}

describe('promptHash', () => {
  it('is the sha256 hex of the prompt text', () => {
    expect(promptHash('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(promptHash('a')).not.toBe(promptHash('b'))
  })
})

describe('golden files', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'model-bench-golden-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('holds each case with the hash of its current prompt and every run of its calls', async () => {
    const { golden } = await recordedTips()
    expect(Object.keys(golden.cases)).toEqual(tipsCases.map((c) => c.id))
    const [first] = tipsCases
    expect(golden.cases[first!.id]!.promptHash).toBe(promptHash(prepareCase(first!).promptText))
    expect(golden.cases[first!.id]!.calls.map((c) => [c.caseId, c.run])).toEqual([
      [first!.id, 1],
      [first!.id, 2],
    ])
  })

  it('round-trips through writeGolden and readGolden', async () => {
    const { golden } = await recordedTips()
    expect(writeGolden(join(dir, 'nested'), [golden])).toEqual([
      goldenPath(join(dir, 'nested'), 'tips'),
    ])
    expect(readGolden(join(dir, 'nested'), 'tips')).toEqual(golden)
  })

  it('reads a task with no file as null', () => {
    expect(readGolden(dir, 'plan')).toBeNull()
  })

  it('names the path and the field of a file that does not validate', async () => {
    const { golden } = await recordedTips()
    writeFileSync(goldenPath(dir, 'tips'), JSON.stringify({ ...golden, runs: 0 }))
    expect(() => readGolden(dir, 'tips')).toThrow(/Invalid golden .*tips\.json: runs/)

    writeFileSync(goldenPath(dir, 'tips'), '{')
    expect(() => readGolden(dir, 'tips')).toThrow(/is not valid JSON/)
  })

  it('refuses a file recorded for another task', async () => {
    const { golden } = await recordedTips()
    writeFileSync(goldenPath(dir, 'plan'), JSON.stringify(golden))
    expect(() => readGolden(dir, 'plan')).toThrow(/is for task "tips", not "plan"/)
  })
})

describe('compareGolden', () => {
  it('counts changed prompts among the covered cases, lists the uncovered ones and ignores retired ones', async () => {
    const { golden } = await recordedTips()
    const [first, second] = tipsCases as [(typeof tipsCases)[0], (typeof tipsCases)[0]]
    const edited: GoldenFile = {
      ...golden,
      cases: {
        [first.id]: { ...golden.cases[first.id]!, promptHash: '0'.repeat(64) },
        'tips/retired': golden.cases[first.id]!,
      },
    }

    expect(compareGolden(golden, tipsCases)).toMatchObject({ cases: 2, promptChanged: 0 })
    expect(compareGolden(edited, tipsCases)).toEqual({
      task: 'tips',
      model: MODEL,
      recordedAt: '2026-10-01',
      commit: 'abc1234',
      runs: 2,
      cases: 1,
      promptChanged: 1,
      notInGolden: [second.id],
    })
  })
})

describe('goldenBaselineCalls', () => {
  it("re-scores the recorded output with today's scorer, so a scorer change is not read as a prompt change", async () => {
    const { golden } = await recordedTips(1)
    const [first] = tipsCases
    const stale: GoldenFile = {
      ...golden,
      cases: Object.fromEntries(
        Object.entries(golden.cases).map(([id, entry]) => [
          id,
          { ...entry, calls: entry.calls.map((r) => ({ ...r, scores: { countsInRange: 0 } })) },
        ]),
      ),
    }
    const errored: GoldenFile = {
      ...golden,
      cases: {
        [first!.id]: {
          ...golden.cases[first!.id]!,
          calls: golden.cases[first!.id]!.calls.map((r) => ({ ...r, errorName: 'APICallError' })),
        },
      },
    }

    const calls = goldenBaselineCalls([stale], tipsCases)
    expect(calls.map((r) => r.role)).toEqual(['baseline', 'baseline'])
    // The stale 0 is gone: the output scores as today's scorer scores it.
    expect(calls[0]!.scores).toEqual(prepareCase(first!).score(TIPS_REPLY.object))
    expect(calls[0]!.scores.countsInRange).toBe(1)
    // The supplementary case rejected the full-tips reply when it was recorded.
    expect(calls[1]!.errorName).not.toBeNull()
    expect(calls[1]!.scores).toEqual(errorScores(tipsCases[1]!))
    // An errored call scores as an error does today.
    expect(goldenBaselineCalls([errored], tipsCases)[0]!.scores).toEqual(errorScores(first!))
  })

  it("names the case and says to re-record when today's scorer cannot read a recorded output", async () => {
    const { golden } = await recordedTips(1)
    const [first] = tipsCases
    const reshaped: GoldenFile = {
      ...golden,
      cases: {
        [first!.id]: {
          ...golden.cases[first!.id]!,
          calls: golden.cases[first!.id]!.calls.map((r) => ({ ...r, output: { tips: 'old' } })),
        },
      },
    }
    expect(() => goldenBaselineCalls([reshaped], tipsCases)).toThrow(
      new RegExp(`Golden ${first!.id} run 1 no longer scores with today's scorer .*re-record`),
    )
  })
})

describe('runAgainstGolden', () => {
  it('replays the golden as the baseline and calls only the candidate', async () => {
    const { golden } = await recordedTips()
    const { factory, calls } = mockModelFactory(() => TIPS_REPLY)
    const result = await runAgainstGolden({
      cases: tipsCases,
      baselineCalls: goldenBaselineCalls([golden], tipsCases),
      candidate: 'claude-sonnet-5-5',
      runs: 1,
      maxUsd: 10,
      modelFactory: factory,
    })

    expect(calls.map((c) => c.modelId)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5'])
    expect(result.plannedCalls).toBe(2)
    // Golden runs 1 and 2, in run order, then the candidate's single run.
    expect(result.calls.map((c) => [c.role, c.model, c.run])).toEqual([
      ['baseline', MODEL, 1],
      ['baseline', MODEL, 1],
      ['baseline', MODEL, 2],
      ['baseline', MODEL, 2],
      ['candidate', 'claude-sonnet-5-5', 1],
      ['candidate', 'claude-sonnet-5-5', 1],
    ])
    // Spend is the candidate's alone.
    const candidateSpend = result.calls
      .filter((c) => c.role === 'candidate')
      .reduce((sum, c) => sum + c.costUsd, 0)
    expect(result.spendUsd).toBeCloseTo(candidateSpend)
  })

  it('keeps only the baseline cases and runs the candidate reached when --max-usd stops it', async () => {
    const { golden } = await recordedTips()
    // 200k output tokens at $10 / MTok: $2 a call, so a $1 cap stops after one.
    const { factory } = mockModelFactory(() => ({ ...TIPS_REPLY, outputTokens: 200_000 }))
    const result = await runAgainstGolden({
      cases: tipsCases,
      baselineCalls: goldenBaselineCalls([golden], tipsCases),
      candidate: 'claude-sonnet-5-5',
      runs: 2,
      maxUsd: 1,
      modelFactory: factory,
    })

    expect(result.partial).toBe(true)
    expect(result.calls.map((c) => [c.role, c.caseId, c.run])).toEqual([
      ['baseline', tipsCases[0]!.id, 1],
      ['candidate', tipsCases[0]!.id, 1],
    ])
  })
})

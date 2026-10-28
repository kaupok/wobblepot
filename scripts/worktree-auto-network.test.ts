import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Drives `run_auto_claude` (scripts/worktree-auto-run.sh, HON-1413), the
 * `claude` run at the end of `wt auto`, with `claude` and `curl` stubs on PATH.
 * A network drop must resume the same session with `claude --resume`, at most
 * 3 times; any other failure exits as before.
 */

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const autoRun = path.join(scriptsDir, 'worktree-auto-run.sh')

const NETWORK_ERROR =
  "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)"

// Records each call's arguments and the two variables the worker must not
// pass on. Call N prints line N of $STUB_DIR/claude-script ("ok" exits 0, any
// other line is printed and exits 1).
const CLAUDE_STUB = `#!/usr/bin/env bash
n=$(( $(cat "$STUB_DIR/claude-count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$STUB_DIR/claude-count"
printf 'claude %s | key=%s retry=%s\\n' "$*" "\${ANTHROPIC_API_KEY-unset}" "\${ORCHESTRATOR_RETRY_CONTEXT-unset}" >> "$STUB_DIR/calls"
line=$(sed -n "\${n}p" "$STUB_DIR/claude-script")
echo "working on it"
[ "$line" = ok ] && exit 0
echo "$line" >&2
exit 1
`

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

const CURL_STUB = `#!/usr/bin/env bash
echo "curl $*" >> "$STUB_DIR/curl-calls"
[ "$STUB_CURL_FAILS" = 1 ] && exit 6
exit 0
`

let stubDir: string

beforeEach(() => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-auto-network-'))
  for (const [name, body] of [
    ['claude', CLAUDE_STUB],
    ['curl', CURL_STUB],
  ] as const) {
    fs.writeFileSync(path.join(stubDir, name), body)
    fs.chmodSync(path.join(stubDir, name), 0o755)
  }
})

afterEach(() => {
  fs.rmSync(stubDir, { recursive: true, force: true })
})

function run(claudeRuns: string[], env: Record<string, string> = {}, issue = 'HON-1') {
  fs.writeFileSync(path.join(stubDir, 'claude-script'), claudeRuns.join('\n') + '\n')
  const result = spawnSync(
    'bash',
    [
      '-c',
      `source "${autoRun}"; CLAUDE_MODEL_ARGS=(--model m); CLAUDE_MCP_ARGS=(--strict-mcp-config); run_auto_claude "$1" "$2"`,
      '_',
      '/auto-implement HON-1',
      issue,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH}`,
        STUB_DIR: stubDir,
        ANTHROPIC_API_KEY: 'sk-test',
        ORCHESTRATOR_RETRY_CONTEXT: 'previous attempt',
        ...env,
      },
    },
  )
  const read = (file: string) =>
    fs.existsSync(path.join(stubDir, file))
      ? fs.readFileSync(path.join(stubDir, file), 'utf8').trim().split('\n')
      : []
  // Each run gets its own session ID; <sid> stands for it in the calls.
  const raw = read('calls')
  const sids = new Set(raw.flatMap((c) => c.match(UUID) ?? []))
  const calls = raw.map((c) => c.replace(UUID, '<sid>'))
  return {
    status: result.status,
    out: result.stdout,
    calls,
    sids,
    resumes: calls.filter((c) => c.startsWith('claude --resume <sid> ')),
    curls: read('curl-calls'),
  }
}

describe('run_auto_claude', () => {
  it('continues the session once the API answers after a network drop', () => {
    const r = run([NETWORK_ERROR, 'ok'])

    expect(r.status).toBe(0)
    expect(r.resumes).toEqual([
      'claude --resume <sid> --dangerously-skip-permissions --model m --strict-mcp-config -- The network dropped and stopped this session. Continue /auto-implement HON-1 from where you stopped. | key=unset retry=unset',
    ])
    // The resume names the first call's session, not the newest one in the
    // directory, which can be the PR reviewer's.
    expect(r.calls[0]).toMatch(/^claude --session-id <sid> /)
    expect(r.sids.size).toBe(1)
    expect(r.out).toContain('[wt auto] Network drop — waiting for the Claude API\n')
    expect(r.out).toContain('[wt auto] Network back — continuing the session (resume 1/3)\n')
    // The run's own output still reaches the worker log.
    expect(r.out).toContain(NETWORK_ERROR)
    expect(r.curls).toEqual(['curl -sS -o /dev/null --max-time 10 https://api.anthropic.com'])
  })

  it('runs the first call with its own session ID and the original prompt', () => {
    const r = run(['ok'])

    expect(r.status).toBe(0)
    expect(r.calls).toEqual([
      'claude --session-id <sid> --dangerously-skip-permissions --model m --strict-mcp-config -- /auto-implement HON-1 | key=unset retry=unset',
    ])
    expect(r.out).not.toContain('[wt auto]')
  })

  it('exits with the error and does not resume on a failure that is not the network', () => {
    const r = run(['Error: prompt is too long', 'ok'])

    expect(r.status).toBe(1)
    expect(r.resumes).toEqual([])
    expect(r.curls).toEqual([])
    expect(r.out).not.toContain('[wt auto]')
  })

  it('resumes at most 3 times, then exits 1', () => {
    const r = run([NETWORK_ERROR, NETWORK_ERROR, NETWORK_ERROR, NETWORK_ERROR, 'ok'])

    expect(r.status).toBe(1)
    expect(r.resumes).toHaveLength(3)
    expect(r.calls).toHaveLength(4)
    expect(r.sids.size).toBe(1)
    expect(r.out).toContain('(resume 3/3)')
    expect(r.out).not.toContain('(resume 4/3)')
  })

  it('exits 1 without a resume when the API does not answer within WT_AUTO_NETWORK_WAIT', () => {
    const r = run([NETWORK_ERROR, 'ok'], { STUB_CURL_FAILS: '1', WT_AUTO_NETWORK_WAIT: '1' })

    expect(r.status).toBe(1)
    expect(r.resumes).toEqual([])
    expect(r.curls.length).toBeGreaterThanOrEqual(1)
    expect(r.out).toContain('[wt auto] Network drop — waiting for the Claude API')
    expect(r.out).not.toContain('Network back')
  })

  it('treats ECONNRESET on the API Error line as a network drop', () => {
    const r = run(['API Error: Connection error. (ECONNRESET)', 'ok'])

    expect(r.status).toBe(0)
    expect(r.resumes).toHaveLength(1)
  })

  it('leaves the issue out of the resume prompt when wt auto runs discovery', () => {
    const r = run([NETWORK_ERROR, 'ok'], {}, '')

    expect(r.resumes[0]).toContain(
      '-- The network dropped and stopped this session. Continue /auto-implement from where you stopped.',
    )
  })
})

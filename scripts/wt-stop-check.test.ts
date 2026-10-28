import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { scriptsDir, worktreeClaude } from './orchestrator-test-harness'

// `wt stop` checks its own drain (HON-575 B4): no `claude` worker left running,
// and no drained issue left where the picker skips it forever.
const stopCheck = path.join(scriptsDir, 'wt-stop-check.sh')

function run(script: string, env: Record<string, string> = {}, args: string[] = []) {
  const result = spawnSync('bash', ['-c', `source "${stopCheck}"; ${script}`, '_', ...args], {
    encoding: 'utf8',
    env: { ...process.env, LINEAR_API_KEY: '', ...env },
  })
  return { out: result.stdout, status: result.status }
}

const verdict = (snapshot: string, orphans: string, states: string) =>
  run('stop_drain_verdict "$1" "$2" "$3"', {}, [snapshot, orphans, states])

const tmpDirs: string[] = []
const children: ChildProcess[] = []
// Processes started outside Node's child list, by PID.
const strays: number[] = []

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-stop-check-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL')
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already exited, as it should after `wt stop`.
    }
  }
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

// A `curl` on PATH that records its request body and prints a fixed reply.
function fakeCurl(reply: string) {
  const dir = tmpDir()
  const bin = path.join(dir, 'curl')
  fs.writeFileSync(
    bin,
    `#!/bin/bash\nwhile [ $# -gt 0 ]; do [ "$1" = -d ] && printf '%s\\n' "$2" >> "${dir}/requests"; shift; done\nprintf '%s' '${reply}'\n`,
  )
  fs.chmodSync(bin, 0o755)
  return { dir, env: { PATH: `${dir}:${process.env.PATH}`, LINEAR_API_KEY: 'lin_api_test' } }
}

const QUEUED = '{"data":{"issue":{"state":{"name":"Queued"},"assignee":null}}}'

describe('stop_drain_snapshot', () => {
  it('lists each worker as issue and PID from the status file', () => {
    const file = path.join(tmpDir(), 'status.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        triage_timeout: 120,
        workers: [
          { issue: 'HON-1287', pid: 87399, branch: 'henri/hon-1287-x' },
          { issue: 'HON-1288', pid: 95553, branch: 'henri/hon-1288-y' },
        ],
      }),
    )

    expect(run('stop_drain_snapshot "$1"', {}, [file]).out).toBe(
      'HON-1287\t87399\nHON-1288\t95553\n',
    )
  })

  it.each([
    ['a missing file', null],
    ['an unparseable file', 'not json'],
    ['no workers key', '{}'],
  ])('prints nothing for %s', (_label, content) => {
    const file = path.join(tmpDir(), 'status.json')
    if (content !== null) fs.writeFileSync(file, content)

    expect(run('stop_drain_snapshot "$1"', {}, [file])).toEqual({ out: '', status: 0 })
  })
})

describe('stop_drain_orphans', () => {
  const start = (argv0: string) => {
    const child = spawn('sleep', ['30'], { argv0, stdio: 'ignore' })
    children.push(child)
    return child.pid!
  }

  it('lists a worker whose PID still runs claude', () => {
    const pid = start('claude')

    expect(run('stop_drain_orphans "$1"', {}, [`HON-1\t${pid}`]).out).toBe(`HON-1\t${pid}\n`)
  })

  it('lists a worker whose PID still runs the wt auto shell', () => {
    const pid = start(worktreeClaude)

    expect(run('stop_drain_orphans "$1"', {}, [`HON-1\t${pid}`]).out).toBe(`HON-1\t${pid}\n`)
  })

  it('skips a PID that now runs a different command', () => {
    const pid = start('sleep')

    expect(run('stop_drain_orphans "$1"', {}, [`HON-1\t${pid}`]).out).toBe('')
  })

  it('skips a PID that has exited', () => {
    const exited = spawnSync('bash', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim()

    expect(run('stop_drain_orphans "$1"', {}, [`HON-1\t${exited}`]).out).toBe('')
  })
})

describe('stop_drain_issue_states', () => {
  it("prints each issue's state and assignee from Linear", () => {
    const curl = fakeCurl(
      '{"data":{"issue":{"state":{"name":"In Progress"},"assignee":{"name":"Worker Bot"}}}}',
    )

    expect(run('stop_drain_issue_states "$1"', curl.env, ['HON-7\t123']).out).toBe(
      'HON-7\tIn Progress\tWorker Bot\n',
    )
    const request = JSON.parse(fs.readFileSync(path.join(curl.dir, 'requests'), 'utf8'))
    expect(request.variables).toEqual({ id: 'HON-7' })
  })

  it('prints an empty assignee for an unassigned issue', () => {
    const curl = fakeCurl('{"data":{"issue":{"state":{"name":"Queued"},"assignee":null}}}')

    expect(run('stop_drain_issue_states "$1"', curl.env, ['HON-7\t123']).out).toBe(
      'HON-7\tQueued\t\n',
    )
  })

  it.each([
    ['Linear returns an error', '{"errors":[{"message":"Entity not found"}]}', 'lin_api_test'],
    ['LINEAR_API_KEY is not set', '{"data":{"issue":{"state":{"name":"Queued"}}}}', ''],
  ])('prints an empty state when %s', (_label, reply, key) => {
    const curl = fakeCurl(reply)

    expect(
      run('stop_drain_issue_states "$1"', { ...curl.env, LINEAR_API_KEY: key }, ['HON-7\t123']).out,
    ).toBe('HON-7\t\t\n')
  })
})

describe('stop_drain_verdict', () => {
  const snapshot = 'HON-1\t101\nHON-2\t102'

  it('passes when no worker runs and no issue is stuck', () => {
    expect(verdict(snapshot, '', 'HON-1\tQueued\t\nHON-2\tIn Review\tHenri')).toEqual({
      out: 'Drain check: passed (2 worker(s): none left running, no issue stuck)\n',
      status: 0,
    })
  })

  it('fails on a worker that still runs and names the kill command', () => {
    const result = verdict(snapshot, 'HON-2\t102', 'HON-1\tQueued\t\nHON-2\tQueued\t')

    expect(result.status).toBe(1)
    expect(result.out).toBe(
      '  FAIL HON-2: its worker (PID 102) still runs. Stop it: pkill -P 102; kill 102\n' +
        'Drain check: 1 problem(s) across 2 worker(s)\n',
    )
  })

  it('fails on an issue left In Progress', () => {
    const result = verdict(snapshot, '', 'HON-1\tIn Progress\tWorker Bot\nHON-2\tDone\t')

    expect(result.status).toBe(1)
    expect(result.out).toContain(
      'FAIL HON-1: still In Progress and assigned to Worker Bot. Move it to Queued and clear the assignee',
    )
  })

  it('fails on an issue back in Queued that is still assigned', () => {
    const result = verdict(snapshot, '', 'HON-1\tQueued\tWorker Bot\nHON-2\tQueued\t')

    expect(result.status).toBe(1)
    expect(result.out).toContain(
      'FAIL HON-1: Queued but assigned to Worker Bot, so the orchestrator skips it',
    )
  })

  it('reports an issue Linear could not read as unchecked, not passed', () => {
    const result = verdict(snapshot, '', 'HON-1\tQueued\t\nHON-2\t\t')

    expect(result.status).toBe(0)
    expect(result.out).toBe(
      '  ???? HON-2: could not read its state from Linear. Check that it is not In Progress\n' +
        'Drain check: no worker left running; 1 of 2 issue(s) unchecked\n',
    )
  })

  it('says so when no workers were active', () => {
    expect(verdict('', '', '')).toEqual({ out: 'Drain check: no workers were active\n', status: 0 })
  })
})

describe('wt stop', () => {
  // A fake orchestrator that, like the real one, deletes its status file on
  // exit. So the check can name the worker only from a snapshot taken before
  // the first signal.
  function stop(workerPid: number, linearReply: string) {
    const home = tmpDir()
    const base = path.join(home, '.worktrees', 'wobblepot')
    fs.mkdirSync(base, { recursive: true })
    const status = path.join(base, 'orchestrator-status.json')
    fs.writeFileSync(status, JSON.stringify({ workers: [{ issue: 'HON-7', pid: workerPid }] }))
    // Double-forked, so the system reaps it on exit. As a direct child, it would
    // stay a zombie while spawnSync blocks Node, and `kill -0` on a zombie
    // succeeds, so `wt stop` would wait its full bound.
    const orchestratorPid = Number(
      spawnSync(
        'bash',
        [
          '-c',
          '( trap \'rm -f "$1"; exit 0\' TERM; while :; do sleep 0.1; done ) >/dev/null 2>&1 & echo $!',
          '_',
          status,
        ],
        { encoding: 'utf8' },
      ).stdout,
    )
    strays.push(orchestratorPid)
    fs.writeFileSync(path.join(base, 'orchestrator.pid'), String(orchestratorPid))

    // The real .env, when there is one, wins over LINEAR_API_KEY here, and the
    // stub curl answers either way.
    const curl = fakeCurl(linearReply)
    const result = spawnSync('bash', [worktreeClaude, 'stop'], {
      encoding: 'utf8',
      env: { ...process.env, ...curl.env, HOME: home },
    })
    return {
      out: result.stdout.replace(/\x1b\[[0-9;]*m/g, ''),
      statusFileLeft: fs.existsSync(status),
    }
  }

  it('reports a worker that still runs claude, after the orchestrator deleted its status file', () => {
    const worker = spawn('sleep', ['30'], { argv0: 'claude', stdio: 'ignore' })
    children.push(worker)

    const result = stop(worker.pid!, QUEUED)

    expect(result.statusFileLeft).toBe(false)
    expect(result.out).toContain(`FAIL HON-7: its worker (PID ${worker.pid}) still runs`)
    expect(result.out).toContain('Drain check: 1 problem(s) across 1 worker(s)')
  })

  it('passes when the worker has exited and its issue is Queued and unassigned', () => {
    const exited = Number(spawnSync('bash', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout)

    expect(stop(exited, QUEUED).out).toContain(
      'Drain check: passed (1 worker(s): none left running, no issue stuck)',
    )
  })

  // The status file holds the PID `wt auto` was started with: the shell, with
  // claude as its child so it can continue the session after a network drop
  // (HON-1413). The kill the check prints must reach claude, or the shell
  // exits and leaves claude running unseen. So this runs the real launch, with
  // a `claude` stub that records its PID and then waits.
  it('names a kill that reaches the claude the wt auto shell started', () => {
    const dir = tmpDir()
    fs.writeFileSync(
      path.join(dir, 'claude'),
      `#!/bin/bash\necho $$ > "${dir}/pid"\nexec sleep 30\n`,
    )
    fs.chmodSync(path.join(dir, 'claude'), 0o755)
    const shell = spawn(
      'bash',
      [
        '-c',
        `source "${path.join(scriptsDir, 'worktree-auto-run.sh')}"; CLAUDE_MODEL_ARGS=(); CLAUDE_MCP_ARGS=(); run_auto_claude p HON-7`,
      ],
      { stdio: 'ignore', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } },
    )
    children.push(shell)
    for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, 'pid')); i++) {
      spawnSync('sleep', ['0.1'])
    }
    const claude = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8'))
    strays.push(claude)

    const out = verdict(`HON-7\t${shell.pid}`, `HON-7\t${shell.pid}`, 'HON-7\tQueued\t').out
    const kill = out.match(/Stop it: (.*)$/m)?.[1]
    expect(kill).toBe(`pkill -P ${shell.pid}; kill ${shell.pid}`)
    spawnSync('bash', ['-c', kill!])
    spawnSync('sleep', ['0.3'])

    expect(spawnSync('kill', ['-0', String(claude)]).status).not.toBe(0)
  })
})

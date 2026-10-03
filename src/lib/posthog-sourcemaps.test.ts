import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn, default: { spawn } }))

import { uploadSourcemaps } from './posthog-sourcemaps'

function fakeChild() {
  const child = new EventEmitter()
  spawn.mockReturnValue(child)
  return child
}

describe('uploadSourcemaps', () => {
  beforeEach(() => {
    spawn.mockReset()
  })

  it('runs the upload script on the build dist dir from the project root', async () => {
    const child = fakeChild()
    const done = uploadSourcemaps({ projectDir: '/app', distDir: '/app/.next' })
    child.emit('close', 0)
    await expect(done).resolves.toBeUndefined()
    expect(spawn).toHaveBeenCalledWith(
      'bash',
      ['/app/scripts/maybe-upload-sourcemaps.sh', '/app/.next'],
      { cwd: '/app', stdio: 'inherit' },
    )
  })

  it('rejects on a non-zero exit, so the build fails', async () => {
    const child = fakeChild()
    const done = uploadSourcemaps({ projectDir: '/app', distDir: '/app/.next' })
    child.emit('close', 1)
    await expect(done).rejects.toThrow('maybe-upload-sourcemaps exited with code 1')
  })

  it('rejects when bash cannot start', async () => {
    const child = fakeChild()
    const done = uploadSourcemaps({ projectDir: '/app', distDir: '/app/.next' })
    child.emit('error', new Error('spawn bash ENOENT'))
    await expect(done).rejects.toThrow('spawn bash ENOENT')
  })
})

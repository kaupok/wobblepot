import { spawn } from 'node:child_process'
import path from 'node:path'

/**
 * `compiler.runAfterProductionCompile` hook: uploads the browser source maps to
 * PostHog and deletes them (`scripts/maybe-upload-sourcemaps.sh`).
 *
 * It has to run here rather than in `postbuild`. On Vercel the Next.js adapter
 * copies `.next/static` into the deployment output inside `next build`, so a
 * `postbuild` inject never ships and a `postbuild` delete never removes a
 * served map (HON-997). This hook runs after compilation and before that copy.
 *
 * A non-zero exit rejects, which fails the build: a deploy whose maps did not
 * reach PostHog has no symbolization, and its maps would otherwise be public.
 */
export function uploadSourcemaps({
  projectDir,
  distDir,
}: {
  projectDir: string
  distDir: string
}): Promise<void> {
  const script = path.join(projectDir, 'scripts', 'maybe-upload-sourcemaps.sh')
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script, distDir], { cwd: projectDir, stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`maybe-upload-sourcemaps exited with code ${code}`))
    })
  })
}

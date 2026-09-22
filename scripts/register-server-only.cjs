/**
 * Preload for operator scripts run under `tsx` that import server modules.
 *
 * `server-only` is not an installed package — Next.js resolves it from its own
 * compiled copy — so a plain `tsx` run dies on `Cannot find module
 * 'server-only'`. Scripts are server code by definition, so the guard has
 * nothing to guard here: resolve it to this (export-less) file instead, the
 * same move `vitest.config.ts` makes with `src/test/server-only-shim.ts`.
 *
 * Usage: `tsx --require ./scripts/register-server-only.cjs <script>`
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a `--require` preload is CommonJS by definition: it must patch the CJS resolver before the script's first import
const Module = require('node:module')

const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'server-only') return __filename
  return originalResolve.call(this, request, ...rest)
}

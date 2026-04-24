// Vitest alias target for `server-only`. Next.js ships the real package, but
// Vite can't resolve it in the unit test environment. This empty shim is a
// no-op, which is correct: `server-only` exists only to throw a build-time
// error when imported from a client bundle, and unit tests are neither.
export {}

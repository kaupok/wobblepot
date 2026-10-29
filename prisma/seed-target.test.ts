import { describe, expect, it } from 'vitest'

import { seedTargetHost, seedTargetLine } from './seed-target'

describe('seedTargetHost', () => {
  it('returns the host and port of a Neon connection string', () => {
    expect(
      seedTargetHost(
        'postgresql://neondb_owner:s3cret-pw@ep-cool-name-a1b2c3-pooler.eu-central-1.aws.neon.tech:5432/neondb?sslmode=require',
      ),
    ).toBe('ep-cool-name-a1b2c3-pooler.eu-central-1.aws.neon.tech:5432')
  })

  it('returns the host alone when the URL has no port', () => {
    expect(seedTargetHost('postgres://user:pw@localhost/db')).toBe('localhost')
  })

  it('names an unset DATABASE_URL rather than throwing', () => {
    expect(seedTargetHost(undefined)).toBe('(DATABASE_URL is not set)')
    expect(seedTargetHost('')).toBe('(DATABASE_URL is not set)')
  })

  it('names a DATABASE_URL that does not parse rather than throwing', () => {
    expect(seedTargetHost('not a url')).toBe('(DATABASE_URL does not parse as a URL)')
  })
})

describe('seedTargetLine', () => {
  it('names the host and leaves out the user, password and database', () => {
    const line = seedTargetLine('postgresql://owner:s3cret-pw@ep-x.neon.tech/neondb')

    expect(line).toBe('[seed] Target database: ep-x.neon.tech')
    expect(line).not.toContain('s3cret-pw')
    expect(line).not.toContain('owner')
  })
})

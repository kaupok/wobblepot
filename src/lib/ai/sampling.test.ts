import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockMkdir = vi.fn()
const mockAppendFile = vi.fn()

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const overrides = {
    ...actual,
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    appendFile: (...args: unknown[]) => mockAppendFile(...args),
  }
  return {
    ...overrides,
    default: overrides,
  }
})

import { logAiSample, type AiSampleInput } from './sampling'

const baseSample: AiSampleInput = {
  callSite: 'imagine-meal',
  locale: 'et',
  input: { prompt: 'midagi kanaga' },
  output: { meals: [{ name: 'Kana riisiga' }] },
}

describe('logAiSample', () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockAppendFile.mockResolvedValue(undefined)
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleInfoSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    vi.unstubAllEnvs()
  })

  describe('locale gating', () => {
    it('returns silently and emits no log when locale is the default (en)', async () => {
      await logAiSample({ ...baseSample, locale: 'en' })
      expect(consoleInfoSpy).not.toHaveBeenCalled()
      expect(mockAppendFile).not.toHaveBeenCalled()
    })

    it('returns silently when locale is null', async () => {
      await logAiSample({ ...baseSample, locale: null })
      expect(consoleInfoSpy).not.toHaveBeenCalled()
      expect(mockAppendFile).not.toHaveBeenCalled()
    })

    it('returns silently when locale is undefined', async () => {
      await logAiSample({ ...baseSample, locale: undefined })
      expect(consoleInfoSpy).not.toHaveBeenCalled()
      expect(mockAppendFile).not.toHaveBeenCalled()
    })
  })

  describe('non-default locale', () => {
    it('emits a [ai-sample]-prefixed JSON line with the expected payload shape', async () => {
      vi.stubEnv('NODE_ENV', 'test')
      await logAiSample(baseSample)

      expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
      const logged = consoleInfoSpy.mock.calls[0]![0] as string
      expect(logged.startsWith('[ai-sample] ')).toBe(true)

      const json = logged.slice('[ai-sample] '.length)
      const payload = JSON.parse(json)
      expect(payload.type).toBe('ai_sample')
      expect(payload.callSite).toBe('imagine-meal')
      expect(payload.locale).toBe('et')
      expect(payload.input).toEqual({ prompt: 'midagi kanaga' })
      expect(payload.output).toEqual({ meals: [{ name: 'Kana riisiga' }] })
      expect(typeof payload.timestamp).toBe('string')
      expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('appends to a dated JSONL file when not in production', async () => {
      vi.stubEnv('NODE_ENV', 'development')
      await logAiSample(baseSample)

      expect(mockMkdir).toHaveBeenCalledTimes(1)
      const mkdirArgs = mockMkdir.mock.calls[0]
      expect(mkdirArgs![0]).toMatch(/\.ai-samples$/)
      expect(mkdirArgs![1]).toEqual({ recursive: true })

      expect(mockAppendFile).toHaveBeenCalledTimes(1)
      const appendArgs = mockAppendFile.mock.calls[0]
      expect(appendArgs![0]).toMatch(/\.ai-samples\/\d{4}-\d{2}-\d{2}\.jsonl$/)
      expect(typeof appendArgs![1]).toBe('string')
      expect((appendArgs![1] as string).endsWith('\n')).toBe(true)
      expect(appendArgs![2]).toBe('utf-8')
    })

    it('skips the dev file write in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      await logAiSample(baseSample)

      expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
      expect(mockMkdir).not.toHaveBeenCalled()
      expect(mockAppendFile).not.toHaveBeenCalled()
    })
  })

  describe('resilience', () => {
    it('does not throw when the filesystem write fails', async () => {
      vi.stubEnv('NODE_ENV', 'development')
      mockAppendFile.mockRejectedValue(new Error('EROFS: read-only file system'))

      await expect(logAiSample(baseSample)).resolves.toBeUndefined()
      expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
    })

    it('does not throw when mkdir fails', async () => {
      vi.stubEnv('NODE_ENV', 'development')
      mockMkdir.mockRejectedValue(new Error('EACCES'))

      await expect(logAiSample(baseSample)).resolves.toBeUndefined()
      expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
    })

    it('does not throw when console.info itself throws and reports via console.error', async () => {
      vi.stubEnv('NODE_ENV', 'test')
      consoleInfoSpy.mockImplementation(() => {
        throw new Error('console wedged')
      })

      await expect(logAiSample(baseSample)).resolves.toBeUndefined()
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      const errArgs = consoleErrorSpy.mock.calls[0]
      expect(errArgs![0]).toContain('[ai-sample]')
    })
  })
})

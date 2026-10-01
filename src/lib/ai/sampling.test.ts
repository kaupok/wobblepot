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

import {
  DEFAULT_LOCALE_SAMPLE_RATE,
  logAiSample,
  SAMPLE_PREFIX,
  type AiSampleInput,
} from './sampling'

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

  function loggedPayload(): Record<string, unknown> {
    const line = consoleInfoSpy.mock.calls[0]![0] as string
    return JSON.parse(line.slice(`${SAMPLE_PREFIX} `.length))
  }

  afterEach(() => {
    consoleInfoSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    vi.unstubAllEnvs()
  })

  describe('sample rate', () => {
    it('logs an English call when the random draw is below the rate', async () => {
      await logAiSample({ ...baseSample, locale: 'en', random: () => 0.04 })
      expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
      const payload = loggedPayload()
      expect(payload.locale).toBe('en')
      expect(payload.sampleRate).toBe(DEFAULT_LOCALE_SAMPLE_RATE)
    })

    it.each([DEFAULT_LOCALE_SAMPLE_RATE, 0.5, 0.999])(
      'skips an English call when the random draw is %s',
      async (draw) => {
        await logAiSample({ ...baseSample, locale: 'en', random: () => draw })
        expect(consoleInfoSpy).not.toHaveBeenCalled()
        expect(mockAppendFile).not.toHaveBeenCalled()
      },
    )

    it.each([null, undefined])('treats a %s locale as English', async (locale) => {
      await logAiSample({ ...baseSample, locale, random: () => 0.5 })
      expect(consoleInfoSpy).not.toHaveBeenCalled()

      await logAiSample({ ...baseSample, locale, random: () => 0 })
      expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
    })

    it.each([0, 0.5, 0.999])('logs every Estonian call, at a draw of %s', async (draw) => {
      await logAiSample({ ...baseSample, locale: 'et', random: () => draw })
      expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
      const payload = loggedPayload()
      expect(payload.sampleRate).toBe(1)
    })

    it('draws from Math.random when no random is passed', async () => {
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.01)
      try {
        await logAiSample({ ...baseSample, locale: 'en' })
        expect(spy).toHaveBeenCalledTimes(1)
        expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
      } finally {
        spy.mockRestore()
      }
    })

    it('does not write the random function into the payload', async () => {
      await logAiSample({ ...baseSample, random: () => 0 })
      expect(Object.keys(loggedPayload())).toEqual([
        'type',
        'timestamp',
        'callSite',
        'locale',
        'sampleRate',
        'input',
        'output',
      ])
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
      expect(payload.sampleRate).toBe(1)
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

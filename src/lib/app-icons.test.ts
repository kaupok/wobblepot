import { describe, expect, it } from 'vitest'

import { getAppIcons } from './app-icons'

const PRODUCTION_METADATA = {
  icon: [
    { url: '/favicon.ico', sizes: 'any' },
    { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
  ],
  apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
}

const MASKABLE = [
  {
    src: '/icons/icon-maskable-192x192.png',
    sizes: '192x192',
    type: 'image/png',
    purpose: 'maskable',
  },
  {
    src: '/icons/icon-maskable-512x512.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: 'maskable',
  },
]

describe('getAppIcons', () => {
  it('points every staging favicon, PWA and Apple icon at /icons/staging', () => {
    expect(getAppIcons('staging').metadata).toEqual({
      icon: [
        { url: '/icons/staging/favicon.ico', sizes: 'any' },
        { url: '/icons/staging/icon-192x192.png', sizes: '192x192', type: 'image/png' },
        { url: '/icons/staging/icon-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: [{ url: '/icons/staging/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    })
  })

  it('gives the staging manifest the dotted icons and the production maskable ones', () => {
    expect(getAppIcons('staging').manifest).toEqual([
      { src: '/icons/staging/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/staging/icon-512x512.png', sizes: '512x512', type: 'image/png' },
      ...MASKABLE,
    ])
  })

  it.each(['production', 'preview', 'dev', 'ci', 'test', undefined])(
    'keeps the production icons for %j',
    (appEnv) => {
      const icons = getAppIcons(appEnv)

      expect(icons.metadata).toEqual(PRODUCTION_METADATA)
      expect(icons.manifest).toEqual([
        { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
        ...MASKABLE,
      ])
    },
  )
})

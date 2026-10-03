import type { StorybookConfig } from '@storybook/nextjs-vite'

// The framework's next/font plugin names each font call's module after its
// arguments, base64-encoded (`\0virtual:next-font:<base64>`), and Rollup names
// the output file after the module. A call with a few options, such as the
// landing page's display face (src/components/landing/display-font.ts), makes
// that name longer than the 255-byte file-name limit, so `build-storybook`
// fails with ENAMETOOLONG (HON-1043). Those files get a hash-only name instead.
const NEXT_FONT_MODULE = /virtual.next-font/

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    // `storybook/viewport` is a subpath export of the `storybook` core package
    // (devDependency), not a separate install. The plugin can't see that.
    // eslint-disable-next-line storybook/no-uninstalled-addons
    'storybook/viewport',
    '@storybook/addon-vitest',
    // Registered per the upstream v3 docs for the CSF 3.0 integration; v2 needed
    // only the `initialize()` call in preview.tsx. Registration on its own wires
    // nothing up, though — `msw-storybook-addon/preview` exports only the
    // `createPreviewAnnotations` factory, so Storybook composes no annotations
    // from it. The load-bearing piece is `mswLoader(setupMswWorker)` in
    // preview.tsx: the loader is what sets `context.msw`, resets handlers, and
    // applies `parameters.msw` (see build/csf3.mjs).
    'msw-storybook-addon',
  ],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  staticDirs: ['../public'],
  viteFinal: (config) => {
    config.build ??= {}
    config.build.rollupOptions ??= {}
    const output = config.build.rollupOptions.output
    if (Array.isArray(output)) throw new Error('viteFinal expects a single Rollup output')
    config.build.rollupOptions.output = {
      ...output,
      chunkFileNames: (chunk) =>
        NEXT_FONT_MODULE.test(chunk.name)
          ? 'assets/next-font-[hash].js'
          : 'assets/[name]-[hash].js',
      assetFileNames: (asset) =>
        asset.names.some((name) => NEXT_FONT_MODULE.test(name))
          ? 'assets/next-font-[hash][extname]'
          : 'assets/[name]-[hash][extname]',
    }
    return config
  },
}

export default config

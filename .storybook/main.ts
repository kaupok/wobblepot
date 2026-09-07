import type { StorybookConfig } from '@storybook/nextjs-vite'

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
}

export default config

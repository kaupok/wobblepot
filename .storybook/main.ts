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
    // msw-storybook-addon 3 is a real Storybook addon and has to be registered
    // here; v2 needed only the `initialize()` call in preview.tsx. Registration
    // is what extends the story context with `msw`, which the loader in
    // preview.tsx then drives from `parameters.msw`.
    'msw-storybook-addon',
  ],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  staticDirs: ['../public'],
}

export default config

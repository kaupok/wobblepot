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
  ],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  staticDirs: ['../public'],
}

export default config

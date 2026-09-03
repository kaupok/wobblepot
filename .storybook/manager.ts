import { addons } from 'storybook/manager-api'
import { create } from 'storybook/theming'

// Brand the manager shell so the sidebar header and the browser tab read
// "Wobblepot" instead of the default "Storybook" — the first thing a visitor
// to the published build (https://kaupok.github.io/wobblepot/) sees.
// Manager-only: the preview iframe, the light/dark toolbar toggle for stories,
// and the Vitest browser project are unaffected.
addons.setConfig({
  theme: create({
    base: 'light',
    brandTitle: 'Wobblepot',
    brandUrl: 'https://wobblepot.com',
    brandTarget: '_blank',
  }),
})

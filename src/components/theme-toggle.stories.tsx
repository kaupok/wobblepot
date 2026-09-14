import type { Decorator, Meta, StoryObj } from '@storybook/nextjs-vite'
import { ThemeProvider } from 'next-themes'
import { ThemeToggle } from './theme-toggle'

// WHY: Without a `next-themes` provider, `useTheme()` returns an undefined
// `resolvedTheme`, so the toggle shows the Sun whatever the toolbar says.
// Forcing the theme from the Storybook toolbar globals keeps the toolbar
// driving both the root `dark` class (via the global `withTailwindTheme`
// decorator) AND the `resolvedTheme` returned to the component, so the icon
// matches as the toolbar flips between Light (Sun) and Dark (Moon).
const withThemeProvider: Decorator = (Story, context) => {
  const theme = (context.globals.theme as string | undefined) ?? 'light'
  return (
    <ThemeProvider attribute="class" forcedTheme={theme}>
      <Story />
    </ThemeProvider>
  )
}

const meta = {
  title: 'UI/ThemeToggle',
  component: ThemeToggle,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Light/dark mode toggle in the root header. Uses `next-themes` to persist the choice and renders a single icon for the current theme — Sun in light, Moon in dark — swapped without animating, since theme switches snap (docs/DESIGN.md → Motion). Toggle the theme toolbar above the canvas to switch the preview between light and dark.',
      },
    },
  },
  decorators: [withThemeProvider],
} satisfies Meta<typeof ThemeToggle>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

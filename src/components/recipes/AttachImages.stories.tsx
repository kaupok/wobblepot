import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Textarea } from '@/components/ui/textarea'
import { MAX_ATTACHED_IMAGES } from '@/lib/image-attachments'
import { AttachImages, type AttachedImage } from './AttachImages'

// A real 1×1 PNG so the thumbnails render as images rather than broken-image
// placeholders — the previews are the whole point of the populated stories.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function makeAttachedImage(name: string, lastModified: number): AttachedImage {
  const bytes = Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0))
  const file = new File([bytes], name, { type: 'image/png', lastModified })
  return { file, previewUrl: URL.createObjectURL(file) }
}

const oneImage = [makeAttachedImage('risotto.png', 1)]
const maxImages = Array.from({ length: MAX_ATTACHED_IMAGES }, (_, i) =>
  makeAttachedImage(`pantry-shelf-${i + 1}.png`, i + 1),
)

const meta = {
  title: 'Feature/Recipes/AttachImages',
  component: AttachImages,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Attach-photo control shared by `/recipes/imagine` and the meal selector’s imagine mode: a hidden file input, the trigger button rendered beside `children`, and a strip of preview thumbnails with per-image remove buttons. State (selection, blob preview URLs, revoke lifecycle) lives in the `useAttachImages` hook; these stories drive the presentational half directly.',
      },
    },
  },
  args: {
    images: [],
    onSelect: fn(),
    onRemove: fn(),
    disabled: false,
    attachLabel: 'Attach photos',
    removeImageLabel: (filename: string) => `Remove ${filename}`,
  },
  decorators: [
    (Story) => (
      <div className="flex max-w-md flex-col gap-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AttachImages>

export default meta
type Story = StoryObj<typeof meta>

/** No attachments yet — trigger enabled, no preview strip. */
export const Empty: Story = {
  args: {
    children: <Textarea rows={3} placeholder="Something healthy with chicken…" />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Attach photos' })).toBeEnabled()
    await expect(canvas.queryByRole('img')).not.toBeInTheDocument()
  },
}

/** One attachment — preview thumbnail with its own labelled remove button. */
export const Populated: Story = {
  args: {
    images: oneImage,
    children: <Textarea aria-label="Prompt" rows={3} defaultValue="What can I make with these?" />,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'risotto.png' })).toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: 'Remove risotto.png' }))
    await expect(args.onRemove).toHaveBeenCalledWith(0)
  },
}

/** At the attachment cap — the trigger is disabled but removal stays available. */
export const AtMaxImages: Story = {
  args: {
    images: maxImages,
    children: (
      <Textarea aria-label="Prompt" rows={3} defaultValue="Dinner from what's on the shelf" />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Attach photos' })).toBeDisabled()
    await expect(canvas.getAllByRole('img')).toHaveLength(MAX_ATTACHED_IMAGES)
    await expect(canvas.getByRole('button', { name: 'Remove pantry-shelf-1.png' })).toBeEnabled()
  },
}

/** Request in flight — every control is inert. */
export const Disabled: Story = {
  args: {
    images: oneImage,
    disabled: true,
    children: <Textarea aria-label="Prompt" rows={3} defaultValue="Generating ideas…" disabled />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Attach photos' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'Remove risotto.png' })).toBeDisabled()
  },
}

/** Without `children` the trigger stands alone — the row still lays out correctly. */
export const WithoutChildren: Story = {
  args: {
    images: oneImage,
  },
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { MAX_ATTACHED_IMAGES, MAX_ATTACHED_IMAGE_SIZE } from '@/lib/image-attachments'
import { AttachImages, useAttachImages } from './AttachImages'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

const MESSAGES = {
  tooManyImages: 'You can attach up to 3 images',
  wrongImageType: 'Images must be JPEG, PNG, or WebP',
  imageTooLarge: 'Each image must be 5 MB or less',
}

/** `jsdom` has no blob URL support — stub it so previews get stable, unique URLs. */
let nextUrlId = 0
const revoked: string[] = []

beforeEach(() => {
  nextUrlId = 0
  revoked.length = 0
  vi.mocked(toast.error).mockClear()
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => `blob:mock/${++nextUrlId}`),
    revokeObjectURL: vi.fn((url: string) => {
      revoked.push(url)
    }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeFile(name: string, { type = 'image/png', size = 1_000 } = {}) {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

/** Harness that wires the hook to the component the way both call sites do. */
function Harness({ disabled = false }: { disabled?: boolean }) {
  const { images, files, handleFileSelect, removeImage, reset } = useAttachImages(MESSAGES)

  return (
    <div>
      <AttachImages
        images={images}
        onSelect={handleFileSelect}
        onRemove={removeImage}
        disabled={disabled}
        attachLabel="Attach photos"
        removeImageLabel={(filename) => `Remove ${filename}`}
      >
        <textarea aria-label="Prompt" />
      </AttachImages>
      <p data-testid="file-names">{files.map((f) => f.name).join(',')}</p>
      <button type="button" onClick={reset}>
        Reset
      </button>
    </div>
  )
}

/** The file input is intentionally hidden, so reach for it directly. */
function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error('file input not found')
  return input as HTMLInputElement
}

async function attach(files: File[]) {
  await userEvent.upload(fileInput(), files, { applyAccept: false })
}

describe('AttachImages', () => {
  it('renders the trigger and the children slot, with no preview strip when empty', () => {
    render(<Harness />)

    expect(screen.getByRole('button', { name: 'Attach photos' })).toBeEnabled()
    expect(screen.getByLabelText('Prompt')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('accepts the mime types in the allow-list via the input accept attribute', () => {
    render(<Harness />)

    expect(fileInput()).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    expect(fileInput()).toHaveAttribute('multiple')
  })

  it('renders a labelled preview and remove button per attachment', async () => {
    render(<Harness />)

    await attach([makeFile('risotto.png'), makeFile('salad.jpg', { type: 'image/jpeg' })])

    expect(screen.getByRole('img', { name: 'risotto.png' })).toHaveAttribute('src', 'blob:mock/1')
    expect(screen.getByRole('img', { name: 'salad.jpg' })).toHaveAttribute('src', 'blob:mock/2')
    expect(screen.getByRole('button', { name: 'Remove risotto.png' })).toBeInTheDocument()
    expect(screen.getByTestId('file-names')).toHaveTextContent('risotto.png,salad.jpg')
  })

  it('disables the trigger once the attachment cap is reached', async () => {
    render(<Harness />)

    await attach(Array.from({ length: MAX_ATTACHED_IMAGES }, (_, i) => makeFile(`shelf-${i}.png`)))

    expect(screen.getByRole('button', { name: 'Attach photos' })).toBeDisabled()
    expect(screen.getAllByRole('img')).toHaveLength(MAX_ATTACHED_IMAGES)
  })

  it('disables every control while disabled', async () => {
    const { rerender } = render(<Harness />)
    await attach([makeFile('risotto.png')])

    rerender(<Harness disabled />)

    expect(screen.getByRole('button', { name: 'Attach photos' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove risotto.png' })).toBeDisabled()
  })
})

describe('useAttachImages', () => {
  it('revokes only the removed image, leaving the others attached', async () => {
    render(<Harness />)
    await attach([makeFile('a.png'), makeFile('b.png'), makeFile('c.png')])

    await userEvent.click(screen.getByRole('button', { name: 'Remove b.png' }))

    expect(revoked).toEqual(['blob:mock/2'])
    expect(screen.getByTestId('file-names')).toHaveTextContent('a.png,c.png')
    expect(screen.queryByRole('img', { name: 'b.png' })).not.toBeInTheDocument()
  })

  it('revokes every preview on reset', async () => {
    render(<Harness />)
    await attach([makeFile('a.png'), makeFile('b.png')])

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))

    expect(revoked).toEqual(['blob:mock/1', 'blob:mock/2'])
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attach photos' })).toBeEnabled()
  })

  it('revokes outstanding previews on unmount', async () => {
    const { unmount } = render(<Harness />)
    await attach([makeFile('a.png'), makeFile('b.png')])

    act(() => unmount())

    expect(revoked).toEqual(['blob:mock/1', 'blob:mock/2'])
  })

  it('rejects the whole batch when it would exceed the cap', async () => {
    render(<Harness />)
    await attach([makeFile('a.png'), makeFile('b.png')])

    await attach([makeFile('c.png'), makeFile('d.png')])

    expect(toast.error).toHaveBeenCalledWith(MESSAGES.tooManyImages)
    expect(screen.getByTestId('file-names')).toHaveTextContent('a.png,b.png')
  })

  it('rejects a batch containing a disallowed mime type', async () => {
    render(<Harness />)

    await attach([makeFile('ok.png'), makeFile('nope.gif', { type: 'image/gif' })])

    expect(toast.error).toHaveBeenCalledWith(MESSAGES.wrongImageType)
    expect(screen.getByTestId('file-names')).toHaveTextContent('')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('rejects a batch containing an oversized file', async () => {
    render(<Harness />)

    await attach([makeFile('huge.png', { size: MAX_ATTACHED_IMAGE_SIZE + 1 })])

    expect(toast.error).toHaveBeenCalledWith(MESSAGES.imageTooLarge)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('creates no preview URL for a rejected batch', async () => {
    render(<Harness />)

    await attach([makeFile('nope.gif', { type: 'image/gif' })])

    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('lets the same file be re-selected after removal by clearing the input', async () => {
    render(<Harness />)
    await attach([makeFile('a.png')])
    expect(fileInput().value).toBe('')

    await userEvent.click(screen.getByRole('button', { name: 'Remove a.png' }))
    await attach([makeFile('a.png')])

    expect(screen.getByTestId('file-names')).toHaveTextContent('a.png')
  })
})

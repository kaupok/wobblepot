'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_ATTACHED_IMAGES,
  validateImageAttachments,
} from '@/lib/image-attachments'

/** A selected file paired with the blob URL rendered as its thumbnail. */
export interface AttachedImage {
  file: File
  previewUrl: string
}

/**
 * Localized rejection messages. The two call sites live in different message
 * namespaces (`recipes.imagine.errors.*` and `meal-plan.selector.imagine.*`)
 * with identical copy, so the hook takes resolved strings rather than a
 * translator — that also keeps it usable from Storybook without an i18n provider.
 */
export interface AttachImagesMessages {
  tooManyImages: string
  wrongImageType: string
  imageTooLarge: string
}

/**
 * Own the state behind {@link AttachImages}: the selected files, their blob
 * preview URLs, and the revoke lifecycle.
 *
 * Rejections are surfaced as toasts (matching both original call sites) and the
 * whole batch is discarded — partial acceptance would make it unclear which of
 * the selected files actually landed.
 */
export function useAttachImages({
  tooManyImages,
  wrongImageType,
  imageTooLarge,
}: AttachImagesMessages) {
  const [images, setImages] = useState<AttachedImage[]>([])

  // Mirror of `images` so the unmount cleanup below can revoke the latest URLs
  // without re-running (and thus revoking live previews) on every change.
  const imagesRef = useRef<AttachedImage[]>([])
  useEffect(() => {
    imagesRef.current = images
  }, [images])

  useEffect(() => {
    return () => {
      imagesRef.current.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl))
    }
  }, [])

  // Rejections and `URL.createObjectURL` are side effects, so they stay out of
  // the `setImages` updater — StrictMode invokes updaters twice, which would
  // double-toast and leak a blob URL per selection.
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      // Reset input so the same file can be re-selected
      e.target.value = ''

      const rejection = validateImageAttachments(files, imagesRef.current.length)
      if (rejection) {
        toast.error(
          rejection === 'too-many'
            ? tooManyImages
            : rejection === 'wrong-type'
              ? wrongImageType
              : imageTooLarge,
        )
        return
      }

      const added = files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))
      setImages((prev) => [...prev, ...added])
    },
    [tooManyImages, wrongImageType, imageTooLarge],
  )

  const removeImage = useCallback((index: number) => {
    const removed = imagesRef.current[index]
    if (!removed) return
    URL.revokeObjectURL(removed.previewUrl)
    setImages((prev) => prev.filter((_, i) => i !== index))
  }, [])

  /** Drop every attachment and revoke its preview URL. */
  const reset = useCallback(() => {
    imagesRef.current.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl))
    imagesRef.current = []
    setImages([])
  }, [])

  const files = useMemo(() => images.map(({ file }) => file), [images])

  return { images, files, handleFileSelect, removeImage, reset }
}

export interface AttachImagesProps {
  /** Attachments to preview, from {@link useAttachImages}. */
  images: AttachedImage[]
  onSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRemove: (index: number) => void
  /** Disables the trigger and the per-thumbnail remove buttons. */
  disabled?: boolean
  attachLabel: string
  removeImageLabel: (filename: string) => string
  /**
   * The input the trigger sits beside — a textarea at both call sites. Rendered
   * inside the same flex row so the trigger aligns to its bottom edge.
   */
  children?: React.ReactNode
}

/**
 * Attach-photo control: a hidden file input, the trigger button beside
 * `children`, and a strip of preview thumbnails with remove buttons.
 */
export function AttachImages({
  images,
  onSelect,
  onRemove,
  disabled = false,
  attachLabel,
  removeImageLabel,
  children,
}: AttachImagesProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <>
      <div className="flex gap-2">
        {children}
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          multiple
          className="hidden"
          onChange={onSelect}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0 self-end"
          disabled={disabled || images.length >= MAX_ATTACHED_IMAGES}
          onClick={() => fileInputRef.current?.click()}
          aria-label={attachLabel}
        >
          <ImagePlus className="h-4 w-4" />
        </Button>
      </div>
      {images.length > 0 && (
        <div className="flex gap-2">
          {images.map(({ file, previewUrl }, index) => (
            <div key={`${file.name}-${file.lastModified}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- blob URL preview, not optimizable */}
              <img
                src={previewUrl}
                alt={file.name}
                className="h-16 w-16 rounded-md border object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(index)}
                disabled={disabled}
                className="bg-background/80 absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border shadow-sm"
                aria-label={removeImageLabel(file.name)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

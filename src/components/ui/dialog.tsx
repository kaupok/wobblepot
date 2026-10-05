'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 bg-background/70 fixed inset-0 z-50 duration-200 ease-out',
        className,
      )}
      {...props}
    />
  )
}

const dialogContentVariants = cva(
  'group/dialog data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed z-50 shadow-modal duration-200 ease-out outline-none',
  {
    variants: {
      size: {
        default:
          'bg-background top-[50%] left-[50%] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl border p-6 sm:max-w-lg',
        // The cook view (docs/DESIGN.md → "Cook view", HON-932). Below `lg` it
        // is the viewport, padded by the safe-area insets so nothing sits under
        // a notch or the home indicator; from `lg` it is a panel 24px inside
        // the viewport, so the dimmed page still frames it. `bg-card` rather
        // than `bg-background`: a callsite that sets `data-meal-surface` on
        // the panel re-scopes `--card` to the meal's tint, and a
        // `bg-background` utility would paint over it (globals.css).
        fullscreen:
          'bg-card text-card-foreground inset-0 flex h-dvh flex-col overflow-hidden p-safe lg:inset-6 lg:h-auto lg:rounded-xl',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof dialogContentVariants> & {
    showCloseButton?: boolean
  }) {
  const t = useTranslations('common')
  const fullscreen = size === 'fullscreen'
  const closeButton = showCloseButton && (
    <DialogPrimitive.Close data-slot="dialog-close" asChild>
      {fullscreen ? (
        // On the chip token, so it reads over the hero image and on the tint
        // alike, and 44px+ (`icon-lg`): a cook taps it with a knuckle. Below
        // `lg` its top offset centres it in the 60px band a callsite's own top
        // bar takes (the cook view's sticky title bar). Its right offset is
        // 20px or more, so it clears a classic scrollbar on the frame's right
        // edge (about 15px).
        <Button
          variant="secondary"
          size="icon-lg"
          className="absolute top-1.5 right-5 z-20 md:top-2 md:right-8 lg:top-6 lg:right-6"
        >
          <XIcon />
          <span className="sr-only">{t('close')}</span>
        </Button>
      ) : (
        // A 32px target (`icon-sm`, docs/DESIGN.md → Spacing) rather than the
        // bare 16px icon. `top-2 right-2` keeps the icon's centre 24px from
        // the corner, where it sat as a bare icon at `top-4 right-4` (HON-810).
        <Button variant="quiet" size="icon-sm" className="absolute top-2 right-2">
          <XIcon />
          <span className="sr-only">{t('close')}</span>
        </Button>
      )}
    </DialogPrimitive.Close>
  )
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-size={size ?? 'default'}
        // Marks the content so `DialogHeader` can reserve room for the
        // absolutely positioned close button (HON-760).
        data-close-button={showCloseButton ? '' : undefined}
        className={cn(dialogContentVariants({ size }), className)}
        {...props}
      >
        {fullscreen ? (
          // The frame is what the children and the close button position
          // against: inside the panel's safe-area padding, so an absolutely
          // placed bar or button clears the notch as the content does.
          <div data-slot="dialog-frame" className="relative min-h-0 flex-1">
            {children}
            {closeButton}
          </div>
        ) : (
          <>
            {children}
            {closeButton}
          </>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        // Keeps a long title clear of the close button, a 32px target at
        // `right-2` that reaches 16px into the content's `p-6`, so `px-8` leaves
        // a 16px gap; dialogs without one keep full width. Below
        // `sm` the header is centred, so it pads both sides to stay centred.
        'flex flex-col gap-2 text-center group-data-close-button/dialog:px-8 sm:text-left sm:group-data-close-button/dialog:pl-0',
        className,
      )}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      // With `asChild` the child is the title, type and all: the cook view
      // renders a `Heading variant="display"` (HON-932), and the default
      // `text-lg` merged onto it would win over its own size.
      className={cn(!props.asChild && 'text-lg leading-none font-semibold', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}

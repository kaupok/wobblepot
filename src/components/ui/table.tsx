import { cn } from '@/lib/utils'

function Table({
  className,
  containerLabel,
  ...props
}: React.ComponentProps<'table'> & {
  /** Accessible name for the scrollable wrapper (announced as a region). */
  containerLabel?: string
}) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
      // The wrapper scrolls horizontally on overflow, so keyboard users need
      // to be able to focus it to scroll (axe: scrollable-region-focusable).
      tabIndex={0}
      role={containerLabel ? 'region' : undefined}
      aria-label={containerLabel}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('bg-muted/50 border-t font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, scope = 'col', ...props }: React.ComponentProps<'th'>) {
  // scope defaults to "col": header cells need an explicit scope for
  // screen-reader column association (axe a11y gate). Pass scope="row"
  // for row headers.
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn(
        'text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('p-2 align-middle whitespace-nowrap', className)}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('text-muted-foreground mt-4 text-sm', className)}
      {...props}
    />
  )
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }

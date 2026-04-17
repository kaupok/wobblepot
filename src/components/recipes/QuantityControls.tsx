import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface QuantityControlsProps {
  totalQuantity: number
  unitLabel: string
  isVague: boolean
  isInvalidQuantity: boolean
  disabled: boolean
  onQuantityChange: (newQuantity: number) => void
  onSetQuantity: () => void
  onMarkAsVague: () => void
}

export function QuantityControls({
  totalQuantity,
  unitLabel,
  isVague,
  isInvalidQuantity,
  disabled,
  onQuantityChange,
  onSetQuantity,
  onMarkAsVague,
}: QuantityControlsProps) {
  if (isVague) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={onSetQuantity} disabled={disabled}>
        Set quantity
      </Button>
    )
  }

  return (
    <>
      <div
        className={cn(
          'flex items-center rounded-md border',
          isInvalidQuantity ? 'border-destructive' : 'border-input',
        )}
      >
        <Input
          type="number"
          value={totalQuantity}
          onChange={(e) => onQuantityChange(parseFloat(e.target.value) || 0)}
          min={0.1}
          step="any"
          aria-label="Quantity"
          className="w-20 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          disabled={disabled}
        />
        {unitLabel && (
          <span className="text-muted-foreground bg-muted border-l px-2 py-1.5 text-sm">
            {unitLabel}
          </span>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onMarkAsVague} disabled={disabled}>
        No quantity
      </Button>
    </>
  )
}

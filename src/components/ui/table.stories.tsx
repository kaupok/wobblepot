import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table'

const meta = {
  title: 'UI/Table',
  component: Table,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Table>

export default meta
type Story = StoryObj<typeof meta>

const pantryRows = [
  { item: 'Arborio rice', quantity: '1 kg', expires: '2026-09-01' },
  { item: 'Olive oil', quantity: '750 ml', expires: '2027-01-15' },
  { item: 'Canned tomatoes', quantity: '4 × 400 g', expires: '2026-11-30' },
]

export const Default: Story = {
  render: () => (
    <Table containerLabel="Pantry staples" className="w-[480px]">
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead>Quantity</TableHead>
          <TableHead>Expires</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pantryRows.map((row) => (
          <TableRow key={row.item}>
            <TableCell>{row.item}</TableCell>
            <TableCell>{row.quantity}</TableCell>
            <TableCell>{row.expires}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
}

export const WithCaptionAndFooter: Story = {
  render: () => (
    <Table containerLabel="Pantry staples with totals" className="w-[480px]">
      <TableCaption>Pantry staples as of this week.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead>Quantity</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pantryRows.map((row) => (
          <TableRow key={row.item}>
            <TableCell>{row.item}</TableCell>
            <TableCell>{row.quantity}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell>{pantryRows.length} items</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
}

export const WithRowHeaders: Story = {
  render: () => (
    <Table containerLabel="Processors" className="w-[480px]">
      <TableHeader>
        <TableRow>
          <TableHead>Vendor</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Region</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          {/* scope="row" overrides the default scope="col" for row headers */}
          <TableHead scope="row" className="font-medium">
            Neon (a Databricks company)
          </TableHead>
          <TableCell>Database</TableCell>
          <TableCell>EU (Frankfurt)</TableCell>
        </TableRow>
        <TableRow>
          <TableHead scope="row" className="font-medium">
            Anthropic
          </TableHead>
          <TableCell>LLM</TableCell>
          <TableCell>US</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}

export const WrappingCells: Story = {
  render: () => (
    <Table className="w-[360px]">
      <TableHeader>
        <TableRow>
          <TableHead>Vendor</TableHead>
          <TableHead className="whitespace-normal">Transfer basis</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>PostHog</TableCell>
          <TableCell className="whitespace-normal">
            EU-US DPF + EU SCCs Module 2 + UK IDTA + Swiss addendum
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}

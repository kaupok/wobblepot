import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import {
  H1,
  H2,
  H3,
  H4,
  P,
  Blockquote,
  Ul,
  Ol,
  Li,
  Code,
  Pre,
  Small,
  Lead,
  Muted,
} from './typography'

describe('Typography Components', () => {
  describe('H1', () => {
    it('renders h1 element', () => {
      render(<H1>Heading 1</H1>)
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveTextContent('Heading 1')
    })

    it('applies heading classes', () => {
      render(<H1>Heading 1</H1>)
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toHaveClass('text-4xl', 'font-extrabold')
    })

    it('accepts custom className', () => {
      render(<H1 className="custom-class">Heading 1</H1>)
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toHaveClass('custom-class')
    })
  })

  describe('H2', () => {
    it('renders h2 element', () => {
      render(<H2>Heading 2</H2>)
      const heading = screen.getByRole('heading', { level: 2 })
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveTextContent('Heading 2')
    })

    it('applies heading classes', () => {
      render(<H2>Heading 2</H2>)
      const heading = screen.getByRole('heading', { level: 2 })
      expect(heading).toHaveClass('text-3xl', 'font-semibold', 'tracking-tight')
    })
  })

  describe('H3', () => {
    it('renders h3 element', () => {
      render(<H3>Heading 3</H3>)
      const heading = screen.getByRole('heading', { level: 3 })
      expect(heading).toBeInTheDocument()
    })
  })

  describe('H4', () => {
    it('renders h4 element', () => {
      render(<H4>Heading 4</H4>)
      const heading = screen.getByRole('heading', { level: 4 })
      expect(heading).toBeInTheDocument()
    })
  })

  describe('P', () => {
    it('renders paragraph element', () => {
      render(<P>Paragraph text</P>)
      const paragraph = screen.getByText('Paragraph text')
      expect(paragraph).toBeInTheDocument()
      expect(paragraph.tagName).toBe('P')
    })

    it('applies paragraph classes', () => {
      render(<P>Paragraph text</P>)
      const paragraph = screen.getByText('Paragraph text')
      expect(paragraph).toHaveClass('leading-7')
    })
  })

  describe('Blockquote', () => {
    it('renders blockquote element', () => {
      render(<Blockquote>Quote text</Blockquote>)
      const blockquote = screen.getByText('Quote text')
      expect(blockquote).toBeInTheDocument()
      expect(blockquote.tagName).toBe('BLOCKQUOTE')
    })

    it('applies blockquote classes', () => {
      render(<Blockquote>Quote text</Blockquote>)
      const blockquote = screen.getByText('Quote text')
      expect(blockquote).toHaveClass('border-l-2', 'italic', 'text-muted-foreground')
    })
  })

  describe('Ul', () => {
    it('renders unordered list', () => {
      render(
        <Ul>
          <Li>Item 1</Li>
          <Li>Item 2</Li>
        </Ul>,
      )
      const list = screen.getByRole('list')
      expect(list).toBeInTheDocument()
      expect(list.tagName).toBe('UL')
    })

    it('applies list classes', () => {
      render(<Ul>List</Ul>)
      const list = screen.getByText('List')
      expect(list).toHaveClass('list-disc')
    })
  })

  describe('Ol', () => {
    it('renders ordered list', () => {
      render(
        <Ol>
          <Li>Item 1</Li>
          <Li>Item 2</Li>
        </Ol>,
      )
      const list = screen.getByRole('list')
      expect(list).toBeInTheDocument()
      expect(list.tagName).toBe('OL')
    })

    it('applies list classes', () => {
      render(<Ol>List</Ol>)
      const list = screen.getByText('List')
      expect(list).toHaveClass('list-decimal')
    })
  })

  describe('Li', () => {
    it('renders list item', () => {
      render(
        <ul>
          <Li>Item text</Li>
        </ul>,
      )
      const item = screen.getByText('Item text')
      expect(item).toBeInTheDocument()
      expect(item.tagName).toBe('LI')
    })
  })

  describe('Code', () => {
    it('renders code element', () => {
      render(<Code>const x = 42</Code>)
      const code = screen.getByText('const x = 42')
      expect(code).toBeInTheDocument()
      expect(code.tagName).toBe('CODE')
    })

    it('applies code classes', () => {
      render(<Code>const x = 42</Code>)
      const code = screen.getByText('const x = 42')
      expect(code).toHaveClass('rounded', 'bg-muted', 'font-mono')
    })
  })

  describe('Pre', () => {
    it('renders pre element', () => {
      render(<Pre>{'code block'}</Pre>)
      const pre = screen.getByText('code block')
      expect(pre).toBeInTheDocument()
      expect(pre.tagName).toBe('PRE')
    })

    it('applies pre classes', () => {
      render(<Pre>code block</Pre>)
      const pre = screen.getByText('code block')
      expect(pre).toHaveClass('rounded-lg', 'border', 'bg-muted')
    })
  })

  describe('Small', () => {
    it('renders small element', () => {
      render(<Small>Small text</Small>)
      const small = screen.getByText('Small text')
      expect(small).toBeInTheDocument()
      expect(small.tagName).toBe('SMALL')
    })

    it('applies small classes', () => {
      render(<Small>Small text</Small>)
      const small = screen.getByText('Small text')
      expect(small).toHaveClass('text-sm', 'font-medium')
    })
  })

  describe('Lead', () => {
    it('renders lead paragraph', () => {
      render(<Lead>Lead text</Lead>)
      const lead = screen.getByText('Lead text')
      expect(lead).toBeInTheDocument()
      expect(lead.tagName).toBe('P')
    })

    it('applies lead classes', () => {
      render(<Lead>Lead text</Lead>)
      const lead = screen.getByText('Lead text')
      expect(lead).toHaveClass('text-xl', 'text-muted-foreground')
    })
  })

  describe('Muted', () => {
    it('renders muted span', () => {
      render(<Muted>Muted text</Muted>)
      const muted = screen.getByText('Muted text')
      expect(muted).toBeInTheDocument()
      expect(muted.tagName).toBe('SPAN')
    })

    it('applies muted classes', () => {
      render(<Muted>Muted text</Muted>)
      const muted = screen.getByText('Muted text')
      expect(muted).toHaveClass('text-muted-foreground')
    })
  })
})

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Heading, Body, Blockquote, Ul, Ol, Li, Code, Pre } from './typography'

describe('Typography Components', () => {
  describe('Heading', () => {
    it('renders h1 by default', () => {
      render(<Heading>Heading 1</Heading>)
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveTextContent('Heading 1')
    })

    it('renders h1 variant', () => {
      render(<Heading variant="h1">Heading 1</Heading>)
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toHaveClass('text-4xl', 'font-extrabold')
    })

    it('renders h2 variant', () => {
      render(<Heading variant="h2">Heading 2</Heading>)
      const heading = screen.getByRole('heading', { level: 2 })
      expect(heading).toHaveClass('text-3xl', 'font-semibold', 'border-b')
    })

    it('renders h3 variant', () => {
      render(<Heading variant="h3">Heading 3</Heading>)
      const heading = screen.getByRole('heading', { level: 3 })
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveClass('text-2xl', 'font-semibold')
    })

    it('renders h4 variant', () => {
      render(<Heading variant="h4">Heading 4</Heading>)
      const heading = screen.getByRole('heading', { level: 4 })
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveClass('text-xl', 'font-semibold')
    })

    it('accepts custom className', () => {
      render(<Heading className="custom-class">Heading</Heading>)
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toHaveClass('custom-class')
    })
  })

  describe('Body', () => {
    it('renders default variant', () => {
      render(<Body>Body text</Body>)
      const body = screen.getByText('Body text')
      expect(body).toBeInTheDocument()
      expect(body.tagName).toBe('P')
      expect(body).toHaveClass('leading-7')
    })

    it('renders lead variant', () => {
      render(<Body variant="lead">Lead text</Body>)
      const body = screen.getByText('Lead text')
      expect(body).toHaveClass('text-xl', 'text-muted-foreground')
    })

    it('renders large variant', () => {
      render(<Body variant="large">Large text</Body>)
      const body = screen.getByText('Large text')
      expect(body).toHaveClass('text-lg', 'font-semibold')
    })

    it('renders small variant', () => {
      render(<Body variant="small">Small text</Body>)
      const body = screen.getByText('Small text')
      expect(body).toHaveClass('text-sm', 'font-medium')
    })

    it('renders muted variant', () => {
      render(<Body variant="muted">Muted text</Body>)
      const body = screen.getByText('Muted text')
      expect(body).toHaveClass('text-sm', 'text-muted-foreground')
    })

    it('accepts custom className', () => {
      render(<Body className="custom-class">Body text</Body>)
      const body = screen.getByText('Body text')
      expect(body).toHaveClass('custom-class')
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
      expect(blockquote).toHaveClass('border-l-2', 'italic', 'text-muted-foreground', 'pl-6')
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
})

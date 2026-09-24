import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import { Heading, Body, Blockquote, Ul, Ol, Li, Code, Pre, toneVariants } from './typography'
import type { BodyTone } from './typography'

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

    it('renders section variant as an h2 by default', () => {
      render(<Heading variant="section">Section</Heading>)
      const heading = screen.getByRole('heading', { level: 2 })
      expect(heading).toHaveTextContent('Section')
      expect(heading).toHaveClass('text-base', 'font-semibold')
    })

    it('does not give the section variant the h2 variant styling', () => {
      render(<Heading variant="section">Section</Heading>)
      const heading = screen.getByRole('heading', { level: 2 })
      // Asserted separately: `toHaveClass(a, b)` requires *all* listed classes, so the
      // negated two-argument form only asserts that one of them is missing.
      expect(heading).not.toHaveClass('text-3xl')
      expect(heading).not.toHaveClass('border-b')
    })

    it('renders caption variant as an h3 by default at the Caption size', () => {
      render(<Heading variant="caption">Group</Heading>)
      const heading = screen.getByRole('heading', { level: 3 })
      expect(heading).toHaveTextContent('Group')
      expect(heading).toHaveClass(
        'text-xs',
        'font-medium',
        'text-muted-foreground',
        'tracking-wide',
        'uppercase',
      )
      // The base `tracking-tight` must lose to `tracking-wide`, not sit beside it.
      expect(heading).not.toHaveClass('tracking-tight')
    })

    it('renders the tag given by as, keeping the variant styling', () => {
      render(
        <Heading variant="h4" as="h3">
          Meal name
        </Heading>,
      )
      const heading = screen.getByRole('heading', { level: 3 })
      expect(heading).toHaveTextContent('Meal name')
      expect(heading).toHaveClass('text-xl', 'font-semibold')
    })

    it('lets as override the section default tag', () => {
      render(
        <Heading variant="section" as="h3">
          Day name
        </Heading>,
      )
      expect(screen.getByRole('heading', { level: 3 })).toHaveClass('text-base', 'font-semibold')
      expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
    })

    it('renders a non-heading tag when as is not a heading', () => {
      render(
        <Heading variant="h4" as="span">
          Not in the outline
        </Heading>,
      )
      const el = screen.getByText('Not in the outline')
      expect(el.tagName).toBe('SPAN')
      expect(el).toHaveClass('text-xl', 'font-semibold')
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
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

    it('renders paragraph variant with a wrapping line-height', () => {
      render(<Body variant="paragraph">Paragraph text</Body>)
      const body = screen.getByText('Paragraph text')
      expect(body).toHaveClass('text-sm', 'leading-normal')
      expect(body).not.toHaveClass('leading-none')
      expect(body).not.toHaveClass('text-muted-foreground')
    })

    it.each(Object.entries(toneVariants).filter(([, cls]) => cls !== '') as [BodyTone, string][])(
      'renders the %s tone as %s',
      (tone, cls) => {
        render(<Body tone={tone}>Toned text</Body>)
        expect(screen.getByText('Toned text')).toHaveClass(cls)
      },
    )

    it('adds no colour class for the default tone', () => {
      render(<Body tone="default">Plain text</Body>)
      const body = screen.getByText('Plain text')
      for (const cls of Object.values(toneVariants).filter(Boolean)) {
        expect(body).not.toHaveClass(cls)
      }
    })

    it('composes tone with variant', () => {
      render(
        <Body variant="small" tone="muted">
          Muted label
        </Body>,
      )
      expect(screen.getByText('Muted label')).toHaveClass(
        'text-sm',
        'font-medium',
        'text-muted-foreground',
      )
    })

    it('renders caption variant', () => {
      render(<Body variant="caption">Caption text</Body>)
      const body = screen.getByText('Caption text')
      expect(body).toHaveClass('text-xs', 'font-medium', 'text-muted-foreground')
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
      expect(list).toHaveClass('list-disc', 'my-6', 'ml-6')
    })

    it('renders the plain variant with no prose margin, indent or markers', () => {
      render(
        <Ul variant="plain">
          <Li>Item</Li>
        </Ul>,
      )
      const list = screen.getByRole('list')
      expect(list).toHaveClass('list-none', 'flex', 'flex-col', 'gap-2')
      expect(list).not.toHaveClass('my-6', 'ml-6', 'list-disc', '[&>li]:mt-2')
    })

    it('keeps list semantics on the plain variant with an explicit role', () => {
      render(<Ul variant="plain">List</Ul>)
      expect(screen.getByText('List')).toHaveAttribute('role', 'list')
    })

    it('adds no role to the default variant', () => {
      render(<Ul>List</Ul>)
      expect(screen.getByText('List')).not.toHaveAttribute('role')
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
      expect(list).toHaveClass('list-decimal', 'my-6', 'ml-6')
    })

    it('renders the plain variant with no prose margin, indent or markers', () => {
      render(
        <Ol variant="plain">
          <Li>Item</Li>
        </Ol>,
      )
      const list = screen.getByRole('list')
      expect(list).toHaveClass('list-none')
      expect(list).not.toHaveClass('my-6', 'ml-6', 'list-decimal', '[&>li]:mt-2')
      expect(list).toHaveAttribute('role', 'list')
    })
  })

  describe('Li', () => {
    it('renders a tone from the shared tone map', () => {
      render(
        <ul>
          <Li tone="warning">Warned item</Li>
        </ul>,
      )
      expect(screen.getByText('Warned item')).toHaveClass(toneVariants.warning)
    })

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

    it('accepts custom className', () => {
      render(
        <ul>
          <Li className="custom-class">Item text</Li>
        </ul>,
      )
      const item = screen.getByText('Item text')
      expect(item).toHaveClass('custom-class')
    })

    it('merges custom className correctly via cn()', () => {
      render(
        <ul>
          <Li className="text-destructive font-bold">Custom styled item</Li>
        </ul>,
      )
      const item = screen.getByText('Custom styled item')
      expect(item).toHaveClass('text-destructive', 'font-bold')
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

    it('is keyboard-focusable so an overflowing block can be scrolled', () => {
      // A `Pre` scrolls horizontally when a line is wider than its container;
      // axe's scrollable-region-focusable rule requires the region to be
      // reachable by keyboard. The HON-686 type scale made this bite in CI.
      render(<Pre>code block</Pre>)
      expect(screen.getByText('code block')).toHaveAttribute('tabindex', '0')
    })

    it('lets a caller override tabIndex', () => {
      render(<Pre tabIndex={-1}>code block</Pre>)
      expect(screen.getByText('code block')).toHaveAttribute('tabindex', '-1')
    })
  })

  describe('Ref forwarding', () => {
    it('forwards ref to Heading element', () => {
      const ref = React.createRef<HTMLHeadingElement>()
      render(<Heading ref={ref}>Test Heading</Heading>)
      expect(ref.current).toBeInstanceOf(HTMLHeadingElement)
      expect(ref.current?.tagName).toBe('H1')
    })

    it('forwards ref to Body element', () => {
      const ref = React.createRef<HTMLParagraphElement>()
      render(<Body ref={ref}>Test Body</Body>)
      expect(ref.current).toBeInstanceOf(HTMLParagraphElement)
      expect(ref.current?.tagName).toBe('P')
    })

    it('forwards ref to Blockquote element', () => {
      const ref = React.createRef<HTMLQuoteElement>()
      render(<Blockquote ref={ref}>Test Quote</Blockquote>)
      expect(ref.current).toBeInstanceOf(HTMLQuoteElement)
      expect(ref.current?.tagName).toBe('BLOCKQUOTE')
    })

    it('forwards ref to Ul element', () => {
      const ref = React.createRef<HTMLUListElement>()
      render(
        <Ul ref={ref}>
          <Li>Item</Li>
        </Ul>,
      )
      expect(ref.current).toBeInstanceOf(HTMLUListElement)
      expect(ref.current?.tagName).toBe('UL')
    })

    it('forwards ref to Ol element', () => {
      const ref = React.createRef<HTMLOListElement>()
      render(
        <Ol ref={ref}>
          <Li>Item</Li>
        </Ol>,
      )
      expect(ref.current).toBeInstanceOf(HTMLOListElement)
      expect(ref.current?.tagName).toBe('OL')
    })

    it('forwards ref to Code element', () => {
      const ref = React.createRef<HTMLElement>()
      render(<Code ref={ref}>const x = 42</Code>)
      expect(ref.current).toBeInstanceOf(HTMLElement)
      expect(ref.current?.tagName).toBe('CODE')
    })

    it('forwards ref to Pre element', () => {
      const ref = React.createRef<HTMLPreElement>()
      render(<Pre ref={ref}>code block</Pre>)
      expect(ref.current).toBeInstanceOf(HTMLPreElement)
      expect(ref.current?.tagName).toBe('PRE')
    })
  })

  describe('Edge cases', () => {
    it('handles null variant in Heading by defaulting to h1', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render(<Heading variant={null as any}>Heading</Heading>)
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveClass('font-extrabold')
    })

    it('handles undefined variant in Heading by defaulting to h1', () => {
      render(<Heading variant={undefined}>Heading</Heading>)
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toBeInTheDocument()
      expect(heading).toHaveClass('font-extrabold')
    })

    it('handles null variant in Body by defaulting to default', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render(<Body variant={null as any}>Text</Body>)
      const body = screen.getByText('Text')
      expect(body).toHaveClass('leading-7')
    })

    it('handles undefined variant in Body by defaulting to default', () => {
      render(<Body variant={undefined}>Text</Body>)
      const body = screen.getByText('Text')
      expect(body).toHaveClass('leading-7')
    })

    it('merges custom className with component classes in Heading', () => {
      render(<Heading className="custom-margin text-destructive">Custom Heading</Heading>)
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toHaveClass('font-extrabold', 'text-destructive', 'custom-margin')
    })

    it('merges custom className with component classes in Body', () => {
      render(<Body className="text-info">Custom Body</Body>)
      const body = screen.getByText('Custom Body')
      expect(body).toHaveClass('leading-7', 'text-info')
    })
  })

  describe('Integration and class merging', () => {
    it('allows text styling classes to override defaults in Body', () => {
      render(<Body className="text-destructive font-bold">Custom styled</Body>)
      const body = screen.getByText('Custom styled')
      // Verify both default and custom classes are present
      expect(body).toHaveClass('leading-7', 'text-destructive', 'font-bold')
    })

    it('allows adding text styling classes to Heading', () => {
      render(<Heading className="text-success underline">Custom styled</Heading>)
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toHaveClass('font-extrabold', 'text-success', 'underline')
    })

    it('composes Body with inline Code correctly', () => {
      render(
        <div>
          <Body>
            Run <Code>npm install</Code> to install.
          </Body>
        </div>,
      )
      const code = screen.getByText('npm install')
      expect(code).toHaveClass('font-mono', 'bg-muted')
    })

    it('applies text styling to nested typography', () => {
      render(
        <div>
          <Body variant="small">
            Small text with <Code className="text-warning">code</Code>
          </Body>
        </div>,
      )
      const code = screen.getByText('code')
      expect(code).toHaveClass('text-warning', 'font-mono')
    })

    it('handles multiple text styling classes without conflicts', () => {
      render(<Body className="text-warning font-bold italic">Multi-styled text</Body>)
      const body = screen.getByText('Multi-styled text')
      expect(body).toHaveClass('leading-7', 'text-warning', 'font-bold', 'italic')
    })

    it('Pre component retains text styling classes from custom className', () => {
      render(<Pre className="text-destructive text-xs">Error details</Pre>)
      const pre = screen.getByText('Error details')
      expect(pre).toHaveClass('bg-muted', 'font-mono', 'text-destructive', 'text-xs')
    })
  })
})

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Blockquote, Body, Code, Heading, Li, Ol, Pre, Ul } from './typography'

const meta: Meta = {
  title: 'UI/Typography',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Typography components handle text styling only. Apply layout (margins, padding) via wrapper elements, not directly on the component.',
      },
    },
  },
}

export default meta
type Story = StoryObj

export const Headings: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Heading variant="h1">Heading level 1</Heading>
      <Heading variant="h2">Heading level 2</Heading>
      <Heading variant="h3">Heading level 3</Heading>
      <Heading variant="h4">Heading level 4</Heading>
      <Heading variant="section">Section — day names, form sections</Heading>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Each variant rendered at its natural tag. `section` is the Section level of the type scale and defaults to an `h2`.',
      },
    },
  },
}

export const SemanticTagOverride: Story = {
  name: 'Tag override (`as`)',
  render: () => (
    // Tags ascend h1 -> h2 -> h3 so the story itself models a valid outline;
    // the sizes deliberately do not follow along.
    <div className="flex flex-col gap-4">
      <Heading variant="h2" as="h1">
        h2 size, h1 tag
      </Heading>
      <Heading variant="section" as="h2">
        Section size, h2 tag — a timeline day name
      </Heading>
      <Heading variant="h4" as="h3">
        h4 size, h3 tag — a meal name under a Dialog title
      </Heading>
      <Heading variant="h4" as="span">
        h4 size, span — out of the document outline entirely
      </Heading>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          '`variant` sets the size, `as` sets the tag. Pick the tag for the document outline (no skipped levels) and the variant for the type scale.',
      },
    },
  },
}

export const BodyVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Body variant="lead">Lead — the introductory paragraph that sets the tone.</Body>
      <Body variant="large">Large — used for emphasis within body copy.</Body>
      <Body variant="default">
        Default — standard paragraph text. Supports multiple sentences with comfortable line-height.
      </Body>
      <Body variant="small">Small — secondary information, compact line-height.</Body>
      <Body variant="muted">Muted — de-emphasised supporting text.</Body>
      <Body variant="caption">Caption — compact labels and metadata.</Body>
    </div>
  ),
}

export const BlockquoteStory: Story = {
  name: 'Blockquote',
  render: () => (
    <Blockquote>
      &ldquo;The best meal plan is the one you actually follow through on.&rdquo;
    </Blockquote>
  ),
}

export const Lists: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <Heading variant="h4">Unordered</Heading>
        <Ul>
          <Li>Chicken thighs</Li>
          <Li>Garlic</Li>
          <Li>Olive oil</Li>
        </Ul>
      </div>
      <div>
        <Heading variant="h4">Ordered</Heading>
        <Ol>
          <Li>Preheat the oven</Li>
          <Li>Season the chicken</Li>
          <Li>Roast for 35 minutes</Li>
        </Ol>
      </div>
    </div>
  ),
}

export const CodeAndPre: Story = {
  name: 'Code',
  render: () => (
    <div className="flex flex-col gap-4">
      <Body>
        Inline code like <Code>const meal = await plan.next()</Code> fits in a sentence.
      </Body>
      <Pre>
        {`import { prisma } from '@/lib/prisma'

const meals = await prisma.meal.findMany()`}
      </Pre>
    </div>
  ),
}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { displayFont } from '@/components/landing/display-font'
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
      <Heading variant="display">Display — the cook view’s meal name</Heading>
      <Heading variant="section">Section — day names, form sections</Heading>
      <Heading variant="caption">Caption — form-group headings under a section</Heading>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Each variant rendered at its natural tag. `display` is the cook view’s meal name (24px, 30px from `lg`; HON-932), the one in-app level above Title, and defaults to an `h2`. `section` is the Section level of the type scale and defaults to an `h2`; `caption` is the Caption level as a heading and defaults to an `h3`.',
      },
    },
  },
}

export const BrandFace: Story = {
  name: 'Brand face (`face="brand"`)',
  render: () => (
    // The font variable sits on the landing page's root in the app; here the
    // story's wrapper carries it. Tags ascend so the outline stays valid.
    <div className={`flex flex-col gap-4 ${displayFont.variable}`}>
      <Heading face="brand">Dinner, decided. For the whole week.</Heading>
      <Heading variant="h3" as="h2" face="brand">
        How it works
      </Heading>
      <Heading variant="h4" as="h3" face="brand">
        Portions follow the people
      </Heading>
      <Heading variant="section" as="h3" face="brand">
        Get a week of meals
      </Heading>
      <Heading variant="h4" as="h3" face="brand">
        Õhtusöök otsustatud: šokolaad, žele, äädikas, üks
      </Heading>
      <Heading variant="h4" as="h3">
        Portions follow the people (default face, for comparison)
      </Heading>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const family = (el: HTMLElement) => getComputedStyle(el).fontFamily
    const brand = canvas.getByRole('heading', { level: 1 })
    const plain = canvas.getByRole('heading', { name: /default face/ })
    await expect(family(brand)).toMatch(/Bricolage Grotesque/)
    await expect(family(plain)).not.toMatch(/Bricolage Grotesque/)
    // A face whose unicode-range covers the Estonian letters loads, so they
    // render in Bricolage rather than a fallback.
    const [primary] = family(brand).split(',')
    const loaded = await document.fonts.load(`700 36px ${primary}`, 'õäöüšž')
    await expect(loaded.length).toBeGreaterThan(0)
  },
  parameters: {
    docs: {
      description: {
        story:
          'Bricolage Grotesque, the wordmark’s face, at each level the landing page uses it: the hero `h1` (700), the section headings (`h3` size), the point titles (`h4`) and the step titles (`section`). Set in HON-1043, for the landing page’s own headings only; in-app headings stay Geist. The Estonian line checks õ, ä, ö, ü, š and ž render in the face.',
      },
    },
  },
}

export const Hero: Story = {
  name: 'Hero (`variant="hero"`)',
  render: () => (
    <div className={`max-w-4xl text-center text-balance ${displayFont.variable}`}>
      <Heading variant="hero" face="brand">
        Dinner, decided. <br />
        For the whole week.
      </Heading>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const heading = within(canvasElement).getByRole('heading', { level: 1 })
    await expect(heading).toHaveAttribute('data-variant', 'hero')
    // Above every other level: 48px below `md`, 72px from `md`, 96px from `lg`.
    await expect(Number.parseFloat(getComputedStyle(heading).fontSize)).toBeGreaterThanOrEqual(48)
  },
  parameters: {
    docs: {
      description: {
        story:
          'The landing page’s one centred headline (HON-1116): 48px on a phone, 72px from `md`, 96px from `lg`, line height 1, bold, in the display face. Marketing only; it renders an `h1` and the `title-scale` design rule fails it inside the app.',
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
      <Heading variant="h3" as="h2">
        h3 size, h2 tag
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
      <Body variant="paragraph">
        Paragraph — multi-line foreground text such as tips and notes. Same size as small, but with
        a line-height that lets it wrap comfortably across several lines.
      </Body>
      <Body variant="muted">Muted — de-emphasised supporting text.</Body>
      <Body variant="caption">Caption — compact labels and metadata.</Body>
      <Body variant="fine-print">
        Fine print — caption size at regular weight, quieter than the captions beside it: the
        nutrition disclaimer (HON-1109).
      </Body>
      <Body variant="figure">
        Figure — 16px semibold: the cook view’s nutrition grams (HON-1114).
      </Body>
      <Body variant="figure-small">
        Figure small — 14px semibold: the nutrition grams on cards and in the recipe form.
      </Body>
      <Body variant="step">
        Step — the cook view’s steps, Watch out and Tip: 20px, 22px from `lg`, relaxed leading, in
        the foreground colour (HON-932).
      </Body>
      <Body variant="step-small">
        Step small — one size below Step (18px, 20px from `lg`), for a line that labels step text:
        the question above its answer in the cook view (HON-1022).
      </Body>
    </div>
  ),
}

export const AllTones: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Body tone="default">Default — inherits the foreground colour.</Body>
      <Body tone="muted">Muted — secondary text.</Body>
      <Body tone="destructive">Destructive — this field is required.</Body>
      <Body tone="success">Success — check your email for a reset link.</Body>
      <Body tone="warning">Warning — this ingredient could not be matched.</Body>
      <Body tone="info">Info — quantity estimated from the recipe.</Body>
      <Body variant="small" tone="muted">
        Small, muted — a single-line label.
      </Body>
      <Ul>
        <Li tone="warning">Li with the warning tone — allergen conflict</Li>
      </Ul>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          '`tone` sets colour on `Body` and `Li` and composes with every `variant`. A tone is never the only cue: the text or an icon must say the same thing.',
      },
    },
  },
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
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <Heading variant="h4">Unordered</Heading>
        <Ul>
          <Li>Chicken thighs</Li>
          <Li>Garlic</Li>
          <Li>Olive oil</Li>
        </Ul>
      </div>
      <div className="flex flex-col gap-3">
        <Heading variant="h4">Unordered, plain</Heading>
        <Ul variant="plain">
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
      <div className="flex flex-col gap-3">
        <Heading variant="h4">Ordered, plain</Heading>
        <Ol variant="plain">
          <Li>Preheat the oven</Li>
          <Li>Season the chicken</Li>
          <Li>Roast for 35 minutes</Li>
        </Ol>
      </div>
      <div className="flex flex-col gap-3">
        <Heading variant="h4">Ordered, steps</Heading>
        <Ol variant="steps">
          <Li>
            <Body variant="step">Heat the oven to 220°C with a rack in the upper third.</Body>
          </Li>
          <Li>
            <Body variant="step">Pat the chicken dry and season it well.</Body>
          </Li>
        </Ol>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          '`default` is a prose list with margins, indent and markers. `plain` is a list inside a layout: no margin, indent or markers, rows stacked by a gap. `steps` is `plain` with 16px between items, for the cook view’s multi-line steps (HON-932). The parent places it with its own gap, as the plain columns do here.',
      },
    },
  },
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

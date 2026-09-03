# Typography Components

Variant-based components for consistent typography. All accept a `className` prop merged via `cn()`.

## `Heading` Component

Renders a heading with consistent styling. `variant` picks the visual level from the type scale:

```tsx
<Heading>Default (h1)</Heading>
<Heading variant="h2">Secondary heading</Heading>
<Heading variant="h3">Tertiary heading</Heading>
<Heading variant="h4">Quaternary heading</Heading>
<Heading variant="section">Section heading — day names, form sections</Heading>
```

**Available variants:** `h1` | `h2` | `h3` | `h4` | `section`

`section` is the Section level of the type scale (`text-base font-semibold`) — day names on the
timeline, form section labels. See [DESIGN.md](./DESIGN.md) → Type scale for when to reach for it.

### The `as` prop — tag independent of size

The visual level and the HTML tag are separate choices. `variant` sets the size; `as` sets the tag.
Pick the tag for the document outline (no skipped levels, one `h1` per page) and the variant for the
type scale:

```tsx
// Renders <h3> at the h4 title size — a meal name directly under a Dialog title
// (an <h2>), where jumping straight to <h4> would break axe's heading-order rule.
<Heading variant="h4" as="h3">
  {meal.name}
</Heading>
```

**Available tags:** `h1` | `h2` | `h3` | `h4` | `h5` | `h6` | `p` | `span` | `div`

Omit `as` and each variant renders its natural tag: `h1`–`h4` render the matching element, and
`section` renders an `h2`. Only reach for `as` when the surrounding outline needs a different level
than the type scale calls for.

## `Body` Component

Renders paragraph text with different text sizes and styles:

```tsx
<Body>Default body text</Body>
<Body variant="lead">Lead/intro text (larger, muted)</Body>
<Body variant="large">Large text (lg, semibold)</Body>
<Body variant="small">Small text (sm, medium weight)</Body>
<Body variant="muted">Muted text (sm, muted color)</Body>
<Body variant="caption">Caption text (xs, medium weight, muted)</Body>
```

**Available variants:** `default` | `lead` | `large` | `small` | `muted` | `caption`

## Separation of Concerns

**Text styling only** (in components):

- Font size, weight, color, line-height, tracking
- Components handle all text presentation concerns

**Layout concerns** (via wrapper elements):

- Margins, padding, display, positioning
- Apply layout classes to a wrapper `<div>` instead of directly on typography components

**Exceptions** - Built-in layout when essential:

- `Blockquote`: includes `pl-6` (padding needed for the border design to work correctly)
- `Ul`/`Ol`: include `my-6 ml-6` (vertical/horizontal spacing is intrinsic to list formatting; ml-6 for indentation, my-6 to match typographic rhythm of other block elements)
- `Pre`: includes `p-4` (padding needed for code block presentation and readability)

### Practical Guidelines

1. **When wrapping would create invalid HTML** (e.g., block elements in inline contexts):
   - Apply minimal spacing directly to the typography component
   - Example: `<Heading className="mb-4">Title</Heading>`

2. **When grouping related typography elements:**
   - Use a flex container with `gap` when all elements need uniform spacing
   - Use nested containers with individual spacing when different relationships need different gaps
   - Example with uniform spacing:

   ```tsx
   <div className="flex flex-col gap-3">
     <Heading variant="h2">Main heading</Heading>
     <Body>Primary description</Body>
   </div>
   ```

   - Example with varied spacing:

   ```tsx
   <div className="flex flex-col gap-6">
     <Heading variant="h2">Main heading</Heading>
     <div className="flex flex-col gap-2">
       <Body>Primary description</Body>
       <Body variant="small">Secondary note</Body>
     </div>
   </div>
   ```

**Example - DON'T:**

```tsx
<Body variant="muted" className="mb-6 block">
  Error ID: 12345
</Body>
```

## Other Components

**`Blockquote`** - Semantic blockquote with left border and padding:

```tsx
<Blockquote>"This is a great quote that I found somewhere online."</Blockquote>
```

**`Ul`/`Ol`/`Li`** - Semantic lists with built-in spacing:

```tsx
<Ul>
  <Li>First item</Li>
  <Li>Second item</Li>
  <Li>Third item</Li>
</Ul>

<Ol>
  <Li>First step</Li>
  <Li>Second step</Li>
  <Li>Third step</Li>
</Ol>
```

**`Code`** - Inline code with styling:

```tsx
<Body>
  Use the <Code>npm install</Code> command to install dependencies.
</Body>
```

**`Pre`** - Code blocks with scrolling and padding:

```tsx
<div className="my-4">
  <Pre>
    {`function example() {
  return "Hello, world!";
}`}
  </Pre>
</div>
```

## Custom Classes

All typography components accept a `className` prop that merges with component classes via the `cn()` utility. **Only pass text-styling classes** (colors, sizes, weights, text-alignment) to maintain separation of concerns:

**DO - text styling classes:**

```tsx
<Pre className="text-destructive text-xs">Error details</Pre>
```

**DON'T - layout classes on component:**

```tsx
<Pre className="mt-2 mb-4">Error details</Pre>
```

**Instead - wrap with layout:**

```tsx
<div className="mt-2 mb-4">
  <Pre className="text-destructive text-xs">Error details</Pre>
</div>
```

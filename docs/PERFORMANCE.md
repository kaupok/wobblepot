# Performance & Optimization Guide

Guide for analyzing and optimizing Next.js bundle size and performance in the Honkadori project.

## Table of Contents

- [Bundle Analysis](#bundle-analysis)
  - [Quick Analysis](#quick-analysis)
  - [Detailed Analysis](#detailed-analysis)
- [Bundle Metrics](#bundle-metrics)
- [Common Optimizations](#common-optimizations)
- [When to Optimize](#when-to-optimize)

## Bundle Analysis

### Quick Analysis

Analyze your Next.js bundle to identify optimization opportunities:

```bash
pnpm build
# Next.js automatically outputs bundle analysis
# Look for "First Load JS" in build output
```

### Detailed Analysis

Use `@next/bundle-analyzer` for detailed analysis with interactive treemap:

```bash
# Install
pnpm add -D @next/bundle-analyzer

# Update next.config.ts:
# const withBundleAnalyzer = require('@next/bundle-analyzer')({
#   enabled: process.env.ANALYZE === 'true',
# })
# module.exports = withBundleAnalyzer(nextConfig)

# Run analysis
ANALYZE=true pnpm build
```

Opens interactive treemap showing package sizes and duplicates.

## Bundle Metrics

**Size**: Compressed JS (what users download)
**First Load JS**: Total JS needed for page load

**Good targets:**

- First Load JS < 100 kB (excellent)
- First Load JS < 200 kB (good)
- First Load JS > 300 kB (needs optimization)

## Common Optimizations

### 1. Dynamic Imports for Heavy Components

```typescript
const HeavyComponent = dynamic(() => import('@/components/HeavyComponent'))

// Client-only
const ClientOnly = dynamic(() => import('@/components/ClientOnly'), { ssr: false })
```

### 2. Tree Shaking

```typescript
// ❌ Bad - imports entire library
import _ from 'lodash'

// ✅ Good - imports specific function
import debounce from 'lodash/debounce'
```

### 3. Replace Large Dependencies

- `moment` → `date-fns` or native `Intl.DateTimeFormat`
- Use npm Package Search MCP to find lightweight alternatives

### 4. Check for Duplicates

```bash
pnpm why <package-name>
```

## When to Optimize

- Adding major dependencies
- Before deploying large features
- Performance feels slow
- First Load JS exceeds 200 kB

**Related:** Use Next.js DevTools MCP for AI-assisted optimization suggestions

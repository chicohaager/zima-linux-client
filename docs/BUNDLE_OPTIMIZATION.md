# Bundle Size Optimization

This document describes the bundle optimization strategies implemented in the ZimaOS Client.

## Current Bundle Size

**Before optimization:** Single bundle of 826 KiB

**After optimization:**
- **Sentry**: 352 KiB (error monitoring, only loaded in production)
- **Vendors**: 232 KiB (third-party dependencies)
- **React**: 132 KiB (React and React-DOM)
- **Main**: 108 KiB (application code)
- **Runtime**: 1.95 KiB (webpack runtime)

**Total**: 827 KiB split across 5 chunks

## Optimizations Implemented

### 1. Code Splitting

Webpack is configured to automatically split bundles into logical chunks:

```javascript
splitChunks: {
  cacheGroups: {
    vendor: { /* All node_modules */ },
    react: { /* React libraries */ },
    sentry: { /* Sentry error monitoring */ },
    common: { /* Shared code across pages */ }
  }
}
```

**Benefits:**
- Better browser caching (chunks change less frequently)
- Parallel loading of resources
- Smaller individual file sizes

### 2. Tree Shaking

Enabled with `usedExports: true` to remove unused code:

```javascript
optimization: {
  usedExports: true
}
```

### 3. Minification

Production builds are automatically minified:
- JavaScript minification (Terser)
- HTML minification
- CSS minification

### 4. Content Hashing

Files are named with content hashes for optimal caching:

```javascript
filename: '[name].[contenthash].js'
```

**Benefits:**
- Browser can cache files indefinitely
- Only changed files need to be re-downloaded
- Prevents cache busting issues

### 5. Runtime Chunk Extraction

Webpack runtime is extracted into a separate file:

```javascript
runtimeChunk: 'single'
```

## Bundle Analysis

To analyze the bundle and see what's taking up space:

```bash
npm run analyze
```

This will:
1. Build the renderer bundle
2. Generate a visual bundle report
3. Open the report in your browser

The report shows:
- Size of each module
- Which modules are included in which chunks
- Duplicate dependencies
- Opportunities for further optimization

## Performance Metrics

Performance budgets are configured:

```javascript
performance: {
  maxEntrypointSize: 512000, // 500 KiB
  maxAssetSize: 512000
}
```

Webpack will warn if these limits are exceeded.

## Further Optimization Opportunities

### 1. Lazy Load Sentry (Production Only)

Sentry is 352 KiB and only needed in production. Could be lazy-loaded:

```typescript
if (process.env.NODE_ENV === 'production') {
  import('./utils/sentry').then(({ initRendererSentry }) => {
    initRendererSentry();
  });
}
```

### 2. Route-Based Code Splitting

When adding more complex pages, split by route:

```typescript
const Backup = React.lazy(() => import('./pages/Backup'));
const Apps = React.lazy(() => import('./pages/Apps'));
```

### 3. Component-Level Code Splitting

For large components that aren't always needed:

```typescript
const HeavyChart = React.lazy(() => import('./components/HeavyChart'));
```

### 4. Dynamic Imports for Features

Load features only when needed:

```typescript
// Load ZeroTier network scanner only when needed
async function scanNetwork() {
  const { NetworkScanner } = await import('./zerotier/scanner');
  return new NetworkScanner().scan();
}
```

## Webpack Configuration

The renderer webpack configuration (`webpack.renderer.config.js`) includes:

- **Mode-based configuration**: Different settings for development and production
- **Bundle analyzer plugin**: Activated with `ANALYZE=true`
- **Split chunks**: Automatic vendor/react/sentry/common chunking
- **Content hashing**: For optimal long-term caching
- **Minification**: Enabled in production mode

## Development vs Production

**Development mode:**
- No minification (faster builds)
- No content hashing (predictable filenames)
- Source maps for debugging
- Fast rebuild times

**Production mode:**
- Full minification
- Content hashing
- Tree shaking
- Performance warnings

## Electron-Specific Considerations

Since this is an Electron desktop app (not a web app):

1. **Bundle size is less critical** - Users download once, not on every page load
2. **No network latency** - Files are loaded from disk, not over network
3. **Code splitting still helps** - Better caching and faster startup
4. **Memory usage** - Splitting reduces memory footprint

## Monitoring

To check bundle sizes after changes:

```bash
npm run build
```

Check the webpack output for size warnings and recommendations.

## References

- [Webpack Code Splitting](https://webpack.js.org/guides/code-splitting/)
- [Webpack Tree Shaking](https://webpack.js.org/guides/tree-shaking/)
- [Webpack Bundle Analyzer](https://github.com/webpack-contrib/webpack-bundle-analyzer)

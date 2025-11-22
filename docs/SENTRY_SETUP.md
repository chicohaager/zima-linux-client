# Sentry Error Monitoring Setup

This document describes how to configure Sentry for error monitoring in the ZimaOS Client.

## Overview

Sentry is integrated into both the main and renderer processes to capture:
- Uncaught exceptions
- Unhandled promise rejections
- React component errors (via Error Boundary)
- Manual error reporting

## Configuration

### 1. Get Sentry DSN

1. Create a Sentry account at https://sentry.io
2. Create a new project for "Electron"
3. Copy your DSN (Data Source Name)

### 2. Set Environment Variable

Set the `SENTRY_DSN` environment variable before building/running:

```bash
export SENTRY_DSN="https://your-sentry-dsn@sentry.io/project-id"
```

For production builds:
```bash
SENTRY_DSN="https://..." npm run build
SENTRY_DSN="https://..." npm run package:linux
```

### 3. Development vs Production

- **Development**: Sentry is disabled by default (errors only logged to console)
- **Production**: Sentry is enabled when `NODE_ENV=production` and DSN is set

To test Sentry in development:
```bash
NODE_ENV=production SENTRY_DSN="..." npm run dev
```

## Features

### Automatic Error Capturing

**Main Process:**
- Uncaught exceptions
- Unhandled promise rejections
- Errors logged via `captureException()`

**Renderer Process:**
- React component errors (Error Boundary)
- Uncaught exceptions
- Manual error reporting

### Data Privacy

The Sentry integration automatically filters sensitive data:
- **Passwords**: Any field with "password" in the name
- **Tokens**: Any field with "token" in the name
- **Secrets**: Any field with "secret" in the name

These fields are replaced with `[Filtered]` before sending to Sentry.

### Manual Error Reporting

**Main Process:**
```typescript
import { captureException, captureMessage, addBreadcrumb } from '@main/utils/sentry';

// Capture an exception
try {
  // risky operation
} catch (error) {
  captureException(error, { context: 'backup-job', jobId: '123' });
}

// Capture a message
captureMessage('Something unusual happened', 'warning');

// Add breadcrumb for debugging context
addBreadcrumb('User clicked backup button', 'user-action', { jobId: '123' });
```

**Renderer Process:**
```typescript
import { captureRendererException, withSentry } from '@renderer/utils/sentry';

// Capture an exception
try {
  // risky operation
} catch (error) {
  captureRendererException(error, { component: 'BackupPage' });
}

// Wrap async functions to auto-capture errors
const handleBackup = withSentry(async (jobId: string) => {
  // This function will automatically report errors to Sentry
  await startBackup(jobId);
}, 'handleBackup');
```

### Error Boundary

The React Error Boundary catches errors in component rendering and provides:
- User-friendly error display
- Error details in expandable section
- "Try Again" button to reset the error state
- Automatic error reporting to Sentry

## Performance Monitoring

Sentry is configured to capture:
- **Traces**: 100% of transactions (`tracesSampleRate: 1.0`)
- **Session Replay**: 10% of sessions, 100% of error sessions

To reduce costs, adjust these rates in:
- `src/main/utils/sentry.ts`
- `src/renderer/utils/sentry.tsx`

## Release Tracking

Errors are tagged with the app version from `package.json`:
```
release: zima-client@0.9.7
```

This allows filtering errors by version in the Sentry dashboard.

## Testing

To test that Sentry is working:

1. Set DSN and enable production mode
2. Trigger a test error:

**Main Process Test:**
```typescript
// Add to src/main/index.ts temporarily
setTimeout(() => {
  throw new Error('Test Sentry error from main process');
}, 5000);
```

**Renderer Process Test:**
```typescript
// Add to any React component temporarily
const TestError = () => {
  throw new Error('Test Sentry error from renderer');
  return null;
};
```

3. Check Sentry dashboard for the reported error

## Disabling Sentry

To disable Sentry:
- Remove or don't set the `SENTRY_DSN` environment variable
- Sentry will automatically be disabled with a console warning

## Troubleshooting

**Errors not appearing in Sentry:**
1. Check that `NODE_ENV=production` is set
2. Verify `SENTRY_DSN` is set correctly
3. Check console for Sentry initialization messages
4. Ensure network connectivity to sentry.io

**Too many errors being reported:**
- Adjust `tracesSampleRate` (lower = fewer traces)
- Adjust `replaysSessionSampleRate` (lower = fewer replays)
- Add filters in `beforeSend` callback

**Sensitive data being sent:**
- Check the `beforeSend` callback in both sentry.ts files
- Add additional filters for your specific use case

## Resources

- [Sentry Electron Documentation](https://docs.sentry.io/platforms/javascript/guides/electron/)
- [Sentry React Documentation](https://docs.sentry.io/platforms/javascript/guides/react/)
- [Data Privacy Best Practices](https://docs.sentry.io/platforms/javascript/data-management/)

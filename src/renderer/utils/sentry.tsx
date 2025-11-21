import * as Sentry from '@sentry/electron/renderer';
import * as SentryReact from '@sentry/react';

/**
 * Initialize Sentry for renderer process
 * Includes React error boundary integration
 */
export function initRendererSentry(): void {
  // Only enable in production
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Sentry] Skipping renderer initialization in development mode');
    return;
  }

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn('[Sentry] No DSN configured for renderer');
    return;
  }

  try {
    Sentry.init({
      dsn,
      integrations: [
        // React-specific integrations
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],

      // Performance monitoring
      tracesSampleRate: 1.0,

      // Session replay for debugging (only 10% of sessions)
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors

      // Filter sensitive data
      beforeSend(event, hint) {
        // Remove passwords and tokens from event data
        if (event.request?.data) {
          const data = event.request.data;
          if (typeof data === 'object' && data !== null) {
            for (const key of Object.keys(data)) {
              if (key.toLowerCase().includes('password') ||
                  key.toLowerCase().includes('token') ||
                  key.toLowerCase().includes('secret')) {
                (data as Record<string, any>)[key] = '[Filtered]';
              }
            }
          }
        }

        return event;
      },
    });

    console.log('[Sentry] Renderer error monitoring initialized');
  } catch (error) {
    console.error('[Sentry] Failed to initialize renderer:', error);
  }
}

/**
 * React Error Boundary component
 * Wraps the app to catch React errors
 */
export const SentryErrorBoundary = SentryReact.ErrorBoundary;

/**
 * Capture renderer exception
 */
export function captureRendererException(error: Error, context?: Record<string, any>): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[Sentry] Would capture renderer error:', error, context);
    return;
  }

  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Wrap async functions to automatically capture errors
 */
export function withSentry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  functionName?: string
): T {
  return (async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (error) {
      captureRendererException(
        error instanceof Error ? error : new Error(String(error)),
        {
          functionName: functionName || fn.name,
          args: args.map((arg, i) => `arg${i}: ${typeof arg}`),
        }
      );
      throw error;
    }
  }) as T;
}

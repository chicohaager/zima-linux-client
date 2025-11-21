import * as Sentry from '@sentry/electron/main';
import { app } from 'electron';

/**
 * Initialize Sentry for error monitoring
 * Only enabled in production builds
 */
export function initSentry(): void {
  // Only enable in production
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Sentry] Skipping initialization in development mode');
    return;
  }

  // Check if DSN is configured via environment variable
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn('[Sentry] No DSN configured, error monitoring disabled');
    return;
  }

  try {
    Sentry.init({
      dsn,
      // Release tracking
      release: `zima-client@${app.getVersion()}`,
      environment: process.env.NODE_ENV || 'production',

      // Adjust sample rate (0.0 - 1.0)
      // 1.0 = 100% of errors sent
      tracesSampleRate: 1.0,

      // Filtering sensitive data
      beforeSend(event, hint) {
        // Filter out errors from specific paths
        if (event.request?.url?.includes('/node_modules/')) {
          return null;
        }

        // Remove sensitive data from breadcrumbs
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map(breadcrumb => {
            // Remove passwords from breadcrumbs
            if (breadcrumb.data) {
              const sanitizedData: Record<string, any> = {};
              for (const [key, value] of Object.entries(breadcrumb.data)) {
                if (key.toLowerCase().includes('password') ||
                    key.toLowerCase().includes('token') ||
                    key.toLowerCase().includes('secret')) {
                  sanitizedData[key] = '[Filtered]';
                } else {
                  sanitizedData[key] = value;
                }
              }
              breadcrumb.data = sanitizedData;
            }
            return breadcrumb;
          });
        }

        // Remove sensitive data from extra context
        if (event.extra) {
          for (const key of Object.keys(event.extra)) {
            if (key.toLowerCase().includes('password') ||
                key.toLowerCase().includes('token') ||
                key.toLowerCase().includes('secret')) {
              event.extra[key] = '[Filtered]';
            }
          }
        }

        return event;
      },

      // User context (anonymous by default)
      initialScope: {
        tags: {
          platform: process.platform,
          arch: process.arch,
          electron_version: process.versions.electron,
          chrome_version: process.versions.chrome,
        },
      },
    });

    console.log('[Sentry] Error monitoring initialized');
  } catch (error) {
    console.error('[Sentry] Failed to initialize:', error);
  }
}

/**
 * Set user context for error tracking
 * @param userId Unique anonymous user ID
 */
export function setSentryUser(userId: string): void {
  if (process.env.NODE_ENV !== 'production') return;

  Sentry.setUser({
    id: userId,
    // Don't include email or username to preserve anonymity
  });
}

/**
 * Capture an exception manually
 * @param error The error to capture
 * @param context Additional context
 */
export function captureException(error: Error, context?: Record<string, any>): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[Sentry] Would capture error:', error, context);
    return;
  }

  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Capture a message
 * @param message The message to capture
 * @param level Severity level
 */
export function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug' = 'info'
): void {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Sentry] Would capture message (${level}):`, message);
    return;
  }

  Sentry.captureMessage(message, level);
}

/**
 * Add breadcrumb for debugging context
 * @param message Breadcrumb message
 * @param category Breadcrumb category
 * @param data Additional data
 */
export function addBreadcrumb(
  message: string,
  category: string = 'default',
  data?: Record<string, any>
): void {
  if (process.env.NODE_ENV !== 'production') return;

  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: 'info',
  });
}

/**
 * Flush Sentry events before app exit
 * Returns promise that resolves when all events are sent
 */
export async function flushSentry(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return;

  try {
    await Sentry.close(2000); // 2 second timeout
  } catch (error) {
    console.error('[Sentry] Failed to flush events:', error);
  }
}

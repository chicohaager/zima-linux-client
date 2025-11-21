import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initRendererSentry, SentryErrorBoundary } from './utils/sentry';
import './i18n'; // Initialize i18n
import './styles.css';

// Initialize Sentry for error monitoring
initRendererSentry();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <SentryErrorBoundary
      fallback={({ error, componentStack, resetError }: {
        error: unknown;
        componentStack: string;
        resetError: () => void;
      }) => (
        <div style={{
          padding: '2rem',
          maxWidth: '800px',
          margin: '2rem auto',
          backgroundColor: '#1A1A1A',
          color: '#FFFFFF',
          borderRadius: '8px',
          border: '2px solid #FF0000',
        }}>
          <h1 style={{ color: '#FF0000', marginBottom: '1rem' }}>
            ⚠️ Application Error
          </h1>
          <p style={{ marginBottom: '1rem' }}>
            The application encountered an unexpected error. This error has been reported.
          </p>
          <details style={{ marginBottom: '1rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
              Error Details
            </summary>
            <pre style={{
              backgroundColor: '#2A2A2A',
              padding: '1rem',
              borderRadius: '4px',
              overflow: 'auto',
              marginTop: '0.5rem',
            }}>
              {error instanceof Error ? error.message : String(error)}
            </pre>
          </details>
          <button
            onClick={resetError}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#007AFF',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Try Again
          </button>
        </div>
      )}
      showDialog={false}
    >
      <App />
    </SentryErrorBoundary>
  </React.StrictMode>
);

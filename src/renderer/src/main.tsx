import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './app/App'
import { ErrorBoundary } from './app/ErrorBoundary'
import './styles/tokens.css'
import './i18n'

const container = document.getElementById('root')
if (container === null) {
  // Loud on purpose: a missing root is a build problem, and a blank window would
  // hide it behind "the app does not start".
  throw new Error('#root element is missing from index.html')
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

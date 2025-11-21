import React, { useEffect, useRef } from 'react';
import { trapFocus } from '../utils/accessibility';

interface FocusTrapProps {
  active: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Focus trap component for modals and dialogs
 * Traps keyboard focus within the component when active
 */
export const FocusTrap: React.FC<FocusTrapProps> = ({ active, children, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;

    const cleanup = trapFocus(containerRef.current);

    // Handle Escape key
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Parent component should handle actual closing
        const event = new CustomEvent('focustrap:escape');
        containerRef.current?.dispatchEvent(event);
      }
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      cleanup();
      document.removeEventListener('keydown', handleEscape);
    };
  }, [active]);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
};

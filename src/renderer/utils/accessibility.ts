/**
 * Accessibility utilities for keyboard navigation and focus management
 */

/**
 * Trap focus within a modal or dialog
 * @param element The container element to trap focus in
 */
export function trapFocus(element: HTMLElement): () => void {
  const focusableElements = element.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );

  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable?.focus();
      }
    } else {
      // Tab
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable?.focus();
      }
    }
  };

  element.addEventListener('keydown', handleKeyDown);

  // Focus first element
  firstFocusable?.focus();

  // Return cleanup function
  return () => {
    element.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Announce message to screen readers
 * @param message The message to announce
 * @param priority The announcement priority ('polite' or 'assertive')
 */
export function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', priority);
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = 'sr-only';
  announcement.textContent = message;

  document.body.appendChild(announcement);

  // Remove after announcement
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
}

/**
 * Create visually hidden but screen-reader accessible text
 * @param text The text to make accessible
 * @returns HTML string with screen reader only class
 */
export function createScreenReaderText(text: string): string {
  return `<span class="sr-only">${text}</span>`;
}

/**
 * Handle keyboard navigation for lists
 * @param event The keyboard event
 * @param currentIndex Current selected index
 * @param itemCount Total number of items
 * @param onSelect Callback when item is selected
 * @returns New index or null
 */
export function handleListKeyboardNavigation(
  event: React.KeyboardEvent,
  currentIndex: number,
  itemCount: number,
  onSelect?: (index: number) => void
): number | null {
  let newIndex: number | null = null;

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      newIndex = Math.min(currentIndex + 1, itemCount - 1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      newIndex = Math.max(currentIndex - 1, 0);
      break;
    case 'Home':
      event.preventDefault();
      newIndex = 0;
      break;
    case 'End':
      event.preventDefault();
      newIndex = itemCount - 1;
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      if (onSelect) {
        onSelect(currentIndex);
      }
      break;
  }

  return newIndex;
}

/**
 * Generate unique IDs for ARIA attributes
 */
let idCounter = 0;
export function generateId(prefix: string = 'a11y'): string {
  return `${prefix}-${++idCounter}`;
}

/**
 * Skip to main content link handler
 */
export function setupSkipToMain(): void {
  const skipLink = document.createElement('a');
  skipLink.href = '#main-content';
  skipLink.textContent = 'Skip to main content';
  skipLink.className = 'sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded';

  document.body.insertBefore(skipLink, document.body.firstChild);
}

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Get contrast ratio between two colors
 * @param color1 First color in hex format
 * @param color2 Second color in hex format
 * @returns Contrast ratio
 */
export function getContrastRatio(color1: string, color2: string): number {
  const getLuminance = (color: string): number => {
    const rgb = parseInt(color.slice(1), 16);
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = (rgb >> 0) & 0xff;

    const [rs, gs, bs] = [r, g, b].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  };

  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if contrast ratio meets WCAG AA standard
 * @param ratio The contrast ratio
 * @param level 'AA' or 'AAA'
 * @param isLargeText Whether the text is large (18pt+ or 14pt+ bold)
 */
export function meetsWCAGStandard(
  ratio: number,
  level: 'AA' | 'AAA' = 'AA',
  isLargeText: boolean = false
): boolean {
  if (level === 'AAA') {
    return isLargeText ? ratio >= 4.5 : ratio >= 7;
  }
  return isLargeText ? ratio >= 3 : ratio >= 4.5;
}

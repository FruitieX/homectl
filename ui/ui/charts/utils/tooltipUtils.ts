/**
 * Utility functions for chart tooltip positioning and animation handling
 */

export interface TooltipRecalculationOptions {
  /**
   * Delay in milliseconds before recalculating tooltip position
   * Useful for waiting for DOM to settle after animations
   */
  delay?: number;
  
  /**
   * Number of retry attempts if recalculation fails
   */
  retries?: number;
  
  /**
   * Interval between retries in milliseconds
   */
  retryInterval?: number;
}

/**
 * Simple utility to recalculate tooltip positions after modal animations
 * This is a lightweight alternative to the full animation tracker
 */
export function recalculateTooltipsAfterAnimation(
  options: TooltipRecalculationOptions = {}
): Promise<void> {
  const { delay = 100, retries = 3, retryInterval = 50 } = options;
  
  return new Promise((resolve) => {
    setTimeout(() => {
      let attempts = 0;
      
      const tryRecalculate = () => {
        try {
          // Force visx tooltip portal to recalculate positions
          const tooltipPortals = document.querySelectorAll('[data-visx-tooltip-portal]');
          
          tooltipPortals.forEach((portal) => {
            // Trigger a reflow to force position recalculation
            const htmlElement = portal as HTMLElement;
            if (htmlElement.style.display !== 'none') {
              const { display } = htmlElement.style;
              htmlElement.style.display = 'none';
              htmlElement.offsetHeight; // Force reflow
              htmlElement.style.display = display;
            }
          });
          
          // Dispatch a custom event that charts can listen to
          window.dispatchEvent(new CustomEvent('tooltip-recalculate', {
            detail: { source: 'animation-complete' }
          }));
          
          resolve();
        } catch (error) {
          attempts++;
          if (attempts < retries) {
            setTimeout(tryRecalculate, retryInterval);
          } else {
            console.warn('Failed to recalculate tooltip positions after animation', error);
            resolve();
          }
        }
      };
      
      tryRecalculate();
    }, delay);
  });
}

/**
 * Hook-compatible function to be called after modal transitions
 * Usage: Call this in a useEffect after modal animation completes
 */
export function handleModalAnimationComplete(
  recalculateCallback?: () => void
): void {
  // Standard delay for most modal animations
  const delay = 150;
  
  setTimeout(() => {
    // Call the chart's recalculation function if provided
    if (recalculateCallback) {
      recalculateCallback();
    }
    
    // Also trigger the general recalculation
    recalculateTooltipsAfterAnimation({ delay: 0 });
  }, delay);
}

/**
 * Detects if an element is currently being animated via CSS transforms
 */
export function isElementAnimating(element: Element): boolean {
  const computedStyle = window.getComputedStyle(element);
  
  // Check for ongoing transitions
  const transitionDuration = computedStyle.transitionDuration;
  if (transitionDuration && transitionDuration !== '0s' && transitionDuration !== '0ms') {
    return true;
  }
  
  // Check for ongoing animations
  const animationDuration = computedStyle.animationDuration;
  if (animationDuration && animationDuration !== '0s' && animationDuration !== '0ms') {
    return true;
  }
  
  return false;
}

/**
 * Waits for all animations on an element to complete
 */
export function waitForAnimationsComplete(
  element: Element,
  timeout = 1000
): Promise<void> {
  return new Promise((resolve) => {
    if (!isElementAnimating(element)) {
      resolve();
      return;
    }
    
    let resolved = false;
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, timeout);
    
    const handleTransitionEnd = () => {
      if (!resolved && !isElementAnimating(element)) {
        resolved = true;
        clearTimeout(timeoutId);
        element.removeEventListener('transitionend', handleTransitionEnd);
        element.removeEventListener('animationend', handleAnimationEnd);
        resolve();
      }
    };
    
    const handleAnimationEnd = () => {
      if (!resolved && !isElementAnimating(element)) {
        resolved = true;
        clearTimeout(timeoutId);
        element.removeEventListener('transitionend', handleTransitionEnd);
        element.removeEventListener('animationend', handleAnimationEnd);
        resolve();
      }
    };
    
    element.addEventListener('transitionend', handleTransitionEnd);
    element.addEventListener('animationend', handleAnimationEnd);
  });
}

/**
 * Simple function to call after DaisyUI modal animations
 * Automatically detects modal and waits for animation completion
 */
export async function handleDaisyUIModalAnimation(
  recalculateCallback?: () => void
): Promise<void> {
  const modal = document.querySelector('.modal-box');
  if (!modal) {
    // No modal found, call callback immediately
    if (recalculateCallback) {
      recalculateCallback();
    }
    return;
  }
  
  try {
    // Wait for modal animations to complete
    await waitForAnimationsComplete(modal, 500);
    
    // Additional settling time
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Recalculate tooltips
    if (recalculateCallback) {
      recalculateCallback();
    }
    
    await recalculateTooltipsAfterAnimation({ delay: 0 });
  } catch (error) {
    console.warn('Error handling modal animation:', error);
    // Fallback: still call the callback
    if (recalculateCallback) {
      recalculateCallback();
    }
  }
}
import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// Throttle helper function
const throttle = <T extends (...args: any[]) => any>(
  func: T,
  delay: number,
): T => {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastExecTime = 0;

  return ((...args: Parameters<T>) => {
    const currentTime = Date.now();

    if (currentTime - lastExecTime > delay) {
      func(...args);
      lastExecTime = currentTime;
    } else {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(
        () => {
          func(...args);
          lastExecTime = Date.now();
        },
        delay - (currentTime - lastExecTime),
      );
    }
  }) as T;
};

// Global tooltip manager to ensure only one tooltip is visible at a time
class TooltipManager {
  private static instance: TooltipManager;
  private activeTooltip: (() => void) | null = null;

  static getInstance(): TooltipManager {
    if (!TooltipManager.instance) {
      TooltipManager.instance = new TooltipManager();
    }
    return TooltipManager.instance;
  }

  setActiveTooltip(hideCallback: () => void): void {
    // Hide any existing tooltip
    if (this.activeTooltip) {
      this.activeTooltip();
    }
    this.activeTooltip = hideCallback;
  }

  clearActiveTooltip(hideCallback: () => void): void {
    if (this.activeTooltip === hideCallback) {
      this.activeTooltip = null;
    }
  }

  hideAll(): void {
    if (this.activeTooltip) {
      this.activeTooltip();
      this.activeTooltip = null;
    }
  }
}

interface TooltipProps {
  children: ReactNode;
  content: string | ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
  disabled?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({
  children,
  content,
  position = 'top',
  delay = 300,
  className = '',
  disabled = false,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isPositioned, setIsPositioned] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const touchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fallbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    let x = 0;
    let y = 0;

    switch (position) {
      case 'top':
        x = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        y = triggerRect.top - tooltipRect.height - 8;
        break;
      case 'bottom':
        x = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        y = triggerRect.bottom + 8;
        break;
      case 'left':
        x = triggerRect.left - tooltipRect.width - 8;
        y = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        break;
      case 'right':
        x = triggerRect.right + 8;
        y = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        break;
    }

    // Ensure tooltip stays within viewport
    x = Math.max(8, Math.min(x, viewport.width - tooltipRect.width - 8));
    y = Math.max(8, Math.min(y, viewport.height - tooltipRect.height - 8));

    setTooltipPosition({ x, y });
    setIsPositioned(true);

    // Clear fallback timeout since we successfully positioned
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
  }, [position]);

  // Throttled version for better performance during scrolling/resizing
  const throttledCalculatePosition = useCallback(
    throttle(calculatePosition, 16), // ~60fps
    [calculatePosition],
  );

  const showTooltip = useCallback(
    (immediate = false) => {
      if (disabled) return;

      // Hide any other active tooltips
      TooltipManager.getInstance().setActiveTooltip(() => {
        setIsVisible(false);
      });

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      const showAction = () => {
        // Set initial position near trigger element to avoid 0,0 flash
        if (triggerRef.current) {
          const triggerRect = triggerRef.current.getBoundingClientRect();
          setTooltipPosition({
            x: triggerRect.left + triggerRect.width / 2,
            y: triggerRect.top - 50, // Rough estimate for top positioning
          });
        }

        setIsVisible(true);
        setIsPositioned(false);
        // Double requestAnimationFrame to ensure DOM has fully updated
        requestAnimationFrame(() => {
          requestAnimationFrame(calculatePosition);
        });

        // Fallback to ensure tooltip becomes visible even if positioning fails
        fallbackTimeoutRef.current = setTimeout(() => {
          setIsPositioned(true);
        }, 100);
      };

      if (immediate) {
        showAction();
      } else {
        timeoutRef.current = setTimeout(showAction, delay);
      }
    },
    [disabled, delay, calculatePosition],
  );

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (touchTimeoutRef.current) {
      clearTimeout(touchTimeoutRef.current);
      touchTimeoutRef.current = null;
    }
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
    setIsVisible(false);
    setIsPositioned(false);
    TooltipManager.getInstance().clearActiveTooltip(() => {
      setIsVisible(false);
    });
  }, []);

  const handleMouseEnter = useCallback(() => {
    showTooltip();
  }, [showTooltip]);

  const handleMouseLeave = useCallback(() => {
    hideTooltip();
  }, [hideTooltip]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // Don't prevent default to allow scrolling
      showTooltip(true); // Show immediately for touch
    },
    [showTooltip],
  );

  const handleTouchEnd = useCallback(() => {
    hideTooltip(); // Hide immediately when touch ends
  }, [hideTooltip]);

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (touchTimeoutRef.current) {
        clearTimeout(touchTimeoutRef.current);
      }
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
      }
    };
  }, []);

  // Add global event handlers to hide tooltips on outside interactions
  useEffect(() => {
    const handleGlobalTouch = (e: TouchEvent) => {
      if (
        isVisible &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        hideTooltip();
      }
    };

    const handleGlobalClick = (e: MouseEvent) => {
      if (
        isVisible &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        hideTooltip();
      }
    };

    const handleScroll = () => {
      if (isVisible) {
        hideTooltip();
      }
    };

    if (isVisible) {
      document.addEventListener('touchstart', handleGlobalTouch, {
        passive: true,
      });
      document.addEventListener('click', handleGlobalClick);
      document.addEventListener('scroll', handleScroll, { passive: true });
      document.addEventListener('wheel', handleScroll, { passive: true });
    }

    return () => {
      document.removeEventListener('touchstart', handleGlobalTouch);
      document.removeEventListener('click', handleGlobalClick);
      document.removeEventListener('scroll', handleScroll);
      document.removeEventListener('wheel', handleScroll);
    };
  }, [isVisible, hideTooltip]);

  // Recalculate position on window resize
  useEffect(() => {
    const handleResize = () => {
      if (isVisible) {
        throttledCalculatePosition();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isVisible, throttledCalculatePosition]);

  const tooltipElement = isVisible ? (
    <div
      ref={tooltipRef}
      className={`fixed z-[9999] px-2 py-1 text-xs text-white bg-gray-900 rounded shadow-lg pointer-events-none transition-opacity duration-200 max-w-xs break-words ${className}`}
      style={{
        left: tooltipPosition.x,
        top: tooltipPosition.y,
        opacity: isVisible && isPositioned ? 1 : 0,
        visibility: isPositioned ? 'visible' : 'hidden',
      }}
    >
      {content}
      {/* Arrow */}
      <div
        className={`absolute w-2 h-2 bg-gray-900 transform rotate-45 ${
          position === 'top'
            ? 'bottom-[-4px] left-1/2 -translate-x-1/2'
            : position === 'bottom'
              ? 'top-[-4px] left-1/2 -translate-x-1/2'
              : position === 'left'
                ? 'right-[-4px] top-1/2 -translate-y-1/2'
                : 'left-[-4px] top-1/2 -translate-y-1/2'
        }`}
      />
    </div>
  ) : null;

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="inline-block"
      >
        {children}
      </div>
      {typeof document !== 'undefined' &&
        tooltipElement &&
        createPortal(tooltipElement, document.body)}
    </>
  );
};

export default Tooltip;
